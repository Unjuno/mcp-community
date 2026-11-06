import { request as nodeRequest } from 'node:http';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Fixture, fixture } from './helpers.js';
import { connect, listen } from './mcp-helpers.js';

describe('official v2 MCP over a real TCP HTTP endpoint', () => {
  let f: Fixture;
  let http: Awaited<ReturnType<typeof listen>>;
  const clients: Client[] = [];
  beforeEach(async () => {
    f = await fixture();
    http = await listen(f);
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await http.close();
    f.db.close();
  });
  const useClient = async (origin: string, token: string) => {
    const c = await connect(origin, token);
    clients.push(c);
    return c;
  };
  it('discovers the modern protocol and typed forum tools', async () => {
    const agent = f.core.identity.createAgent(f.adminContext, { name: 'Reader' });
    const client = await useClient(http.origin, agent.token);
    expect(client.getProtocolEra()).toBe('modern');
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'forum_list_threads',
        'forum_get_thread',
        'forum_create_thread',
        'forum_reply',
      ]),
    );
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
  });
  it('posts as an authenticated agent and exposes thread resources', async () => {
    const agent = f.core.identity.createAgent(f.adminContext, {
      name: 'Writer',
      scopes: ['forum:read', 'forum:write'],
    });
    const client = await useClient(http.origin, agent.token);
    const made = await client.callTool({
      name: 'forum_create_thread',
      arguments: { title: 'Agent proposal', body: 'Please improve the tool.' },
    });
    expect(made.isError).not.toBe(true);
    const id = (made.structuredContent as { id: string }).id;
    const reply = await client.callTool({
      name: 'forum_reply',
      arguments: { threadId: id, body: 'Additional evidence' },
    });
    expect(reply.isError).not.toBe(true);
    const thread = f.core.forum.getThread(f.memberContext, { id });
    expect(thread.posts).toHaveLength(2);
    expect(thread.posts[0]?.authorKind).toBe('agent');
    const resources = await client.listResources();
    expect(resources.resources.some((r) => r.uri === `community://threads/${id}`)).toBe(true);
    const read = await client.readResource({ uri: `community://threads/${id}` });
    expect(JSON.stringify(read)).toContain('Additional evidence');
  });
  it('rejects a write outside the token scope and malformed arguments', async () => {
    const agent = f.core.identity.createAgent(f.adminContext, { name: 'Reader' });
    const client = await useClient(http.origin, agent.token);
    const result = await client.callTool({
      name: 'forum_create_thread',
      arguments: { title: 'Unauthorized', body: 'No' },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('INSUFFICIENT_SCOPE');
    const invalid = await client.callTool({
      name: 'forum_get_thread',
      arguments: { id: 'not-a-uuid' },
    });
    expect(invalid.isError).toBe(true);
    expect(f.core.forum.listThreads(f.memberContext).items).toHaveLength(0);
  });
  it('rejects invalid, missing and revoked bearer credentials without exposing them', async () => {
    const agent = f.core.identity.createAgent(f.adminContext, { name: 'Reader' });
    const client = await useClient(http.origin, agent.token);
    f.core.identity.revokeToken(f.adminContext, agent.tokenId);
    await expect(client.listTools()).rejects.toThrow();
    for (const token of ['', 'secret-invalid-token', agent.token]) {
      const response = await fetch(`${http.origin}/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Bearer');
      if (token) expect(await response.text()).not.toContain(token);
    }
  });
  it('does not expose private backend errors through resource reads or discovery', async () => {
    const agent = f.core.identity.createAgent(f.adminContext, {
      name: 'Reader',
      scopes: ['forum:read'],
    });
    const thread = f.core.forum.createThread(f.adminContext, {
      title: 'Resource error check',
      body: 'Body',
    });
    const client = await useClient(http.origin, agent.token);
    const read = vi.spyOn(f.core.forum, 'getThread').mockImplementation(() => {
      throw new Error('private-database-password-sentinel');
    });
    const list = vi.spyOn(f.core.forum, 'listThreads').mockImplementation(() => {
      throw new Error('private-database-password-sentinel');
    });
    try {
      for (const operation of [
        () => client.readResource({ uri: `community://threads/${thread.id}` }),
        () => client.listResources(),
      ]) {
        const error = await operation().catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).not.toContain('private-database-password-sentinel');
        expect(String(error)).toContain('Resource unavailable');
      }
    } finally {
      read.mockRestore();
      list.mockRestore();
    }
  });
  it('rejects untrusted Origins and Hosts before handling an authenticated request', async () => {
    const agent = f.core.identity.createAgent(f.adminContext, { name: 'Reader' });
    const crossOrigin = await fetch(`${http.origin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.token}`,
        origin: 'https://attacker.invalid',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(crossOrigin.status).toBe(403);
    // Node fetch normalizes Host; use the raw HTTP client to exercise a hostile Host header.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = nodeRequest(
        `${http.origin}/mcp`,
        {
          method: 'POST',
          headers: {
            host: 'attacker.invalid',
            authorization: `Bearer ${agent.token}`,
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });
});
