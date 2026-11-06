import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const directory = mkdtempSync(join(tmpdir(), 'mcp-built-smoke-'));
const portServer = createServer();
portServer.listen(0, '127.0.0.1');
await once(portServer, 'listening');
const port = portServer.address().port;
await new Promise((done) => portServer.close(done));
const origin = `http://127.0.0.1:${port}`;
const config = join(directory, 'extensions.json');
writeFileSync(
  config,
  JSON.stringify({
    extensions: [
      { package: '@mcp-community/example', enabled: true, config: { greeting: 'Verified' } },
    ],
  }),
);
const env = {
  ...process.env,
  NODE_OPTIONS: '',
  NODE_ENV: 'development',
  DATABASE_PATH: join(directory, 'live.sqlite'),
  APP_ORIGIN: origin,
  HOST: '127.0.0.1',
  PORT: String(port),
  EXTENSIONS_FILE: config,
};
function cli(args, input) {
  const result = spawnSync(process.execPath, [resolve('apps/server/dist/cli.js'), ...args], {
    env,
    encoding: 'utf8',
    input,
    timeout: 15000,
  });
  if (result.status !== 0) throw new Error(`CLI ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}
let server;
let client;
try {
  const password = randomBytes(24).toString('base64url');
  cli(
    ['setup', '--username', 'admin', '--name', 'Smoke administrator', '--password-stdin'],
    `${password}\n`,
  );
  cli(['demo:seed', '--as', 'admin']);
  cli(['demo:seed', '--as', 'admin']); // Repeat must not duplicate sample resources.
  const agent = JSON.parse(
    cli([
      'agent:create',
      '--as',
      'admin',
      '--name',
      'Smoke agent',
      '--scopes',
      'forum:read,knowledge:read,ext:example:greet',
    ]),
  );
  server = spawn(process.execPath, [resolve('apps/server/dist/index.js')], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  server.stderr.on('data', (chunk) => {
    errors += chunk.toString();
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Built server exited: ${errors}`);
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(ready, true, 'Built server did not become healthy');
  assert.equal((await fetch(`${origin}/login`)).status, 200);
  client = new Client(
    { name: 'built-release-smoke', version: '0.1.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${agent.token}` } },
    }),
  );
  assert.equal(client.getProtocolEra(), 'modern');
  assert.equal((await client.listTools()).tools.length, 9);
  const resource = await client.callTool({
    name: 'knowledge_get',
    arguments: { id: 'getting-started' },
  });
  assert.equal(resource.isError, undefined);
  const greeting = await client.callTool({
    name: 'ext_example_greet',
    arguments: { subject: 'Release' },
  });
  assert.deepEqual(greeting.structuredContent, { greeting: 'Verified, Release! (by Smoke agent)' });
  const backup = join(directory, 'backup.sqlite');
  const restored = join(directory, 'restored.sqlite');
  cli(['db:backup', '--file', backup]);
  // Restore into a fresh, offline file; never replace a live database/WAL.
  const { copyFileSync } = await import('node:fs');
  copyFileSync(backup, restored);
  const { openDatabase } = await import('@mcp-community/database');
  const recovered = openDatabase(restored);
  try {
    assert.equal(recovered.sqlite.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(
      recovered.sqlite.prepare('SELECT count(*) AS n FROM knowledge_resources').get().n,
      1,
    );
  } finally {
    recovered.close();
  }
  console.log(
    'PASS: compiled server, CLI setup/demo, official modern MCP, external extension, live backup and offline restore',
  );
} finally {
  await client?.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit');
  }
  rmSync(directory, { recursive: true, force: true });
}
