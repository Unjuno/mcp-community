/** Black-box smoke test against a running Docker Compose service.
 * Uses the official MCP client from outside the container and verifies writes across recreation.
 */
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const mode = process.argv[2];
assert.ok(
  mode === 'write' || mode === 'verify',
  'Usage: node scripts/container-smoke.mjs write|verify',
);
const token = process.env.CONTAINER_SMOKE_TOKEN;
assert.ok(token, 'CONTAINER_SMOKE_TOKEN must be provided securely');
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
const title = 'Container persistence probe';
const body = 'A post sent through the official MCP client to a real Compose container.';
const replyBody = 'Second post persisted in the Docker volume.';

const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) });
assert.equal(health.status, 200, 'Container health endpoint must return HTTP 200');
const browser = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(10000) });
assert.equal(browser.status, 200, 'Container must serve its human login page');
const unauthenticated = await fetch(`${origin}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(10000),
});
assert.equal(unauthenticated.status, 401, 'Unauthenticated MCP access must be denied');

const client = new Client(
  { name: 'container-blackbox-smoke', version: '0.1.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  assert.equal(client.getProtocolEra(), 'modern');
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  assert.ok(tools.includes('forum_create_thread') && tools.includes('forum_get_thread'));
  assert.ok(tools.includes('knowledge_get'));
  const knowledge = await client.callTool({
    name: 'knowledge_get',
    arguments: { id: 'getting-started' },
  });
  assert.notEqual(knowledge.isError, true, 'Seeded MCP knowledge must be readable');

  let id;
  if (mode === 'write') {
    const result = await client.callTool({
      name: 'forum_create_thread',
      arguments: { title, body },
    });
    assert.notEqual(result.isError, true, `Thread creation: ${JSON.stringify(result.content)}`);
    id = result.structuredContent?.id;
    assert.match(id, /^[0-9a-f-]{36}$/i);
    const reply = await client.callTool({
      name: 'forum_reply',
      arguments: { threadId: id, body: replyBody },
    });
    assert.notEqual(reply.isError, true, 'MCP reply must succeed');
  } else {
    id = process.env.CONTAINER_SMOKE_THREAD_ID;
    assert.match(id, /^[0-9a-f-]{36}$/i, 'Persistence check requires the original thread ID');
  }
  const fetched = await client.callTool({ name: 'forum_get_thread', arguments: { id } });
  assert.notEqual(fetched.isError, true);
  assert.equal(fetched.structuredContent?.thread?.title, title);
  assert.deepEqual(
    fetched.structuredContent?.posts?.map((p) => p.body),
    [body, replyBody],
  );
  const resource = await client.readResource({ uri: `community://threads/${id}` });
  assert.ok(
    JSON.stringify(resource).includes(replyBody),
    'MCP Resource must contain the persisted reply',
  );

  if (mode === 'write') {
    // Only the non-secret resource ID is printed, to be passed to the second test stage.
    console.log(JSON.stringify({ threadId: id }));
  } else {
    console.log(
      `PASS: persisted thread ${id} survives container recreation; token and resource work`,
    );
  }
} finally {
  await client.close();
}
