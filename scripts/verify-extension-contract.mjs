/**
 * Release gate for the public Extension API, with no npm registry or network access.
 * Uses a packed tarball and a separately compiled v1 consumer, so a future core
 * change cannot silently break the published extension distribution.
 * Requires Linux/macOS tar, npm, and a completed root workspace build.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'mcc-public-contract-'));
try {
  const result = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--workspace', '@mcp-community/extension-api', '--pack-destination', temp, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  )[0];
  assert.ok(result, 'npm pack must create the public extension contract artifact');
  const fileNames = new Set(result.files.map((file) => file.path));
  for (const required of ['dist/index.d.ts', 'dist/index.js', 'LICENSE', 'package.json']) {
    assert.ok(fileNames.has(required), `Public extension-api package is missing ${required}`);
  }

  const modules = join(temp, 'node_modules');
  const installedContract = join(modules, '@mcp-community', 'extension-api');
  mkdirSync(installedContract, { recursive: true });
  execFileSync(
    'tar',
    ['-xzf', join(temp, result.filename), '--strip-components=1', '-C', installedContract],
    { cwd: root },
  );
  assert.equal(
    readFileSync(join(installedContract, 'LICENSE'), 'utf8'),
    readFileSync(join(root, 'LICENSE'), 'utf8'),
    'Distribution must carry the root Apache-2.0 terms',
  );
  // A distinct Zod copy deliberately exercises cross-package schema validation.
  cpSync(join(root, 'node_modules', 'zod'), join(modules, 'zod'), { recursive: true });

  const sourceDir = join(temp, 'src');
  mkdirSync(sourceDir, { recursive: true });
  cpSync(join(root, 'tests/fixtures/extension-v1/index.ts'), join(sourceDir, 'index.ts'));
  writeFileSync(
    join(temp, 'package.json'),
    JSON.stringify({
      name: 'external-compat-extension',
      version: '1.0.0',
      private: true,
      type: 'module',
    }),
  );
  writeFileSync(
    join(temp, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        types: [],
        rootDir: './src',
        outDir: './dist',
      },
      include: ['src/**/*.ts'],
    }),
  );
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '--project', join(temp, 'tsconfig.json')],
    { cwd: temp, stdio: 'pipe' },
  );
  const external = (await import(pathToFileURL(join(temp, 'dist/index.js')).href)).default;
  assert.equal(external.manifest.coreApi, '^1.0.0');
  assert.equal(external.manifest.id, 'compat');

  const { CORE_API_VERSION } = await import('@mcp-community/extension-api');
  const { Community } = await import('@mcp-community/core');
  const { openDatabase } = await import('@mcp-community/database');
  const db = openDatabase(':memory:');
  try {
    const core = new Community(db, { extensions: [{ extension: external, config: {} }] });
    const admin = await core.identity.bootstrapAdmin({
      username: 'admin',
      name: 'Administrator',
      password: 'Contract-test-only-strong-passphrase!',
    });
    const cli = { actorId: admin.id, scopes: [], channel: 'cli' };
    core.forum.createThread(cli, {
      title: 'ABI contract topic',
      body: 'Preserved through core upgrades',
    });
    const agent = core.identity.createAgent(cli, {
      name: 'Independent extension agent',
      scopes: ['ext:compat:threads', 'forum:read'],
    });
    const principal = core.identity.authenticateToken(agent.token);
    const tool = core.extensions.tool('ext_compat_threads');
    assert.ok(tool, 'The independently compiled v1 tool must be registered');
    assert.deepEqual(await tool.execute({}, principal), {
      count: 1,
      actor: 'Independent extension agent',
      contractVersion: CORE_API_VERSION,
    });
  } finally {
    db.close();
  }
  console.log(
    'PASS: packed public API, independent TypeScript v1 extension and real core invocation',
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
