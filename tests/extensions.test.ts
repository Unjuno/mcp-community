import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Community } from '@mcp-community/core';
import { example } from '@mcp-community/example';
import type { CommunityExtension } from '@mcp-community/extension-api';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfiguredExtensions } from '../apps/server/src/extension-loader.js';
import { fixture } from './helpers.js';
import { connect, listen } from './mcp-helpers.js';

const config = { greeting: 'Welcome' };
const enabled = [{ extension: example, config }];
const fixtures: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(() => {
  for (const item of fixtures.splice(0)) item.db.close();
});

describe('extension API contracts', () => {
  it('registers and invokes a third-party tool without touching core code', async () => {
    const f = await fixture();
    fixtures.push(f);
    const core = new Community(f.db, { extensions: enabled });
    const admin = { actorId: f.admin.id, scopes: [], channel: 'cli' as const };
    const writer = core.identity.createAgent(admin, {
      name: 'Extension agent',
      scopes: ['ext:example:greet'],
    });
    const ctx = core.identity.authenticateToken(writer.token);
    const tool = core.extensions.tool('ext_example_greet');
    expect(tool).toBeDefined();
    await expect(tool?.execute({ subject: 'makers' }, ctx)).resolves.toEqual({
      greeting: 'Welcome, makers! (by Extension agent)',
    });
    expect(core.runtime.allowedScopes.has('ext:example:greet')).toBe(true);
  });
  it('rejects incompatible versions, undeclared scopes, invalid config and duplicate IDs', async () => {
    const f = await fixture();
    fixtures.push(f);
    const alternate = (manifest: Partial<CommunityExtension['manifest']>): CommunityExtension => ({
      ...example,
      manifest: { ...example.manifest, ...manifest },
    });
    expect(
      () =>
        new Community(f.db, {
          extensions: [{ extension: alternate({ coreApi: '^9.0.0' }), config }],
        }),
    ).toThrow(/Incompatible/);
    expect(
      () => new Community(f.db, { extensions: [{ extension: example, config: { greeting: 12 } }] }),
    ).toThrow(/Invalid configuration/);
    expect(
      () =>
        new Community(f.db, {
          extensions: [
            enabled[0] ?? { extension: example, config },
            enabled[0] ?? { extension: example, config },
          ],
        }),
    ).toThrow(/Duplicate extension/);
    expect(
      () =>
        new Community(f.db, {
          extensions: [{ extension: alternate({ permissions: ['forum:write'] }), config }],
        }),
    ).toThrow(/Invalid extension permission/);
  });
  it('enforces auth and output schema for tool invocation', async () => {
    const f = await fixture();
    fixtures.push(f);
    const core = new Community(f.db, { extensions: enabled });
    const admin = { actorId: f.admin.id, scopes: [], channel: 'cli' as const };
    const guest = core.identity.createAgent(admin, {
      name: 'Read-only agent',
      scopes: ['forum:read'],
    });
    const ctx = core.identity.authenticateToken(guest.token);
    const tool = core.extensions.tool('ext_example_greet');
    await expect(tool?.execute({ subject: 'all' }, ctx)).rejects.toMatchObject({
      status: 403,
      code: 'INSUFFICIENT_SCOPE',
    });
    expect(core.extensions.tools(ctx)).toHaveLength(0);
    const invalid: CommunityExtension = {
      manifest: {
        id: 'badoutput',
        name: 'Bad output',
        version: '1.0.0',
        coreApi: '^1.0.0',
        permissions: ['ext:badoutput:run'],
      },
      register(registry) {
        registry.registerTool({
          name: 'run',
          requiredScope: 'ext:badoutput:run',
          readOnly: true,
          description: 'Invalid output',
          inputSchema: z.strictObject({}),
          outputSchema: z.strictObject({ done: z.boolean() }),
          execute: () => ({ done: 'oops' as unknown as boolean }),
        });
      },
    };
    const other = new Community(f.db, { extensions: [{ extension: invalid, config: {} }] });
    const authorized = other.identity.createAgent(admin, {
      name: 'Bad output agent',
      scopes: ['ext:badoutput:run'],
    });
    await expect(
      other.extensions
        .tool('ext_badoutput_run')
        ?.execute({}, other.identity.authenticateToken(authorized.token)),
    ).rejects.toMatchObject({ code: 'INVALID_EXTENSION_OUTPUT' });
  });
  it('loads only enabled npm packages from local config, and rejects bad package specifiers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcc-ext-'));
    try {
      const path = join(dir, 'extensions.json');
      writeFileSync(
        path,
        JSON.stringify({ extensions: [{ package: '@mcp-community/example', enabled: false }] }),
      );
      expect(await loadConfiguredExtensions(path)).toHaveLength(0);
      writeFileSync(
        path,
        JSON.stringify({
          extensions: [{ package: '@mcp-community/example', enabled: true, config }],
        }),
      );
      expect((await loadConfiguredExtensions(path))[0]?.extension.manifest.id).toBe('example');
      writeFileSync(
        path,
        JSON.stringify({ extensions: [{ package: '../../attack', enabled: true }] }),
      );
      await expect(loadConfiguredExtensions(path)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('blocks read-only extensions from mutating community services even with write scopes', async () => {
    const f = await fixture();
    fixtures.push(f);
    const admin = { actorId: f.admin.id, scopes: [], channel: 'cli' as const };
    const testExtension: CommunityExtension = {
      manifest: {
        id: 'readonly',
        name: 'Read-only guard regression',
        version: '1.0.0',
        coreApi: '^1.0.0',
        permissions: ['ext:readonly:thread', 'ext:readonly:proposal'],
      },
      register(registry) {
        registry.registerTool({
          name: 'thread',
          description: 'Read-only tool attempting to create a thread',
          requiredScope: 'ext:readonly:thread',
          readOnly: true,
          inputSchema: z.strictObject({}),
          outputSchema: z.strictObject({ done: z.boolean() }),
          execute(_input, context) {
            context.forum.createThread({ title: 'Should not exist', body: 'No mutation allowed' });
            return { done: true };
          },
        });
        registry.registerTool({
          name: 'proposal',
          description: 'Read-only tool attempting to propose knowledge',
          requiredScope: 'ext:readonly:proposal',
          readOnly: true,
          inputSchema: z.strictObject({}),
          outputSchema: z.strictObject({ done: z.boolean() }),
          execute(_input, context) {
            context.knowledge.propose({
              id: 'readonly-check',
              baseRevision: 1,
              title: 'Changed title',
              body: 'Should not be proposed',
              sources: [],
            });
            return { done: true };
          },
        });
      },
    };
    const core = new Community(f.db, { extensions: [{ extension: testExtension, config: {} }] });
    core.knowledge.create(admin, {
      id: 'readonly-check',
      title: 'Original title',
      body: 'Original content',
      sources: [],
    });
    const agent = core.identity.createAgent(admin, {
      name: 'Read-only extension actor',
      scopes: [
        'ext:readonly:thread',
        'ext:readonly:proposal',
        'forum:write',
        'forum:read',
        'knowledge:propose',
        'knowledge:read',
      ],
    });
    const principal = core.identity.authenticateToken(agent.token);
    for (const name of ['ext_readonly_thread', 'ext_readonly_proposal']) {
      await expect(core.extensions.tool(name)?.execute({}, principal)).rejects.toMatchObject({
        status: 403,
        code: 'EXTENSION_READ_ONLY',
      });
    }
    expect(core.forum.listThreads(principal).items).toEqual([]);
    expect(core.knowledge.listProposals(admin).items).toEqual([]);
  });

  it('still allows explicitly writable extension tools to use the authorized forum facade', async () => {
    const f = await fixture();
    fixtures.push(f);
    const writerExtension: CommunityExtension = {
      manifest: {
        id: 'writer',
        name: 'Scoped write tool',
        version: '1.0.0',
        coreApi: '^1.0.0',
        permissions: ['ext:writer:create'],
      },
      register(registry) {
        registry.registerTool({
          name: 'create',
          description: 'Create a discussion',
          requiredScope: 'ext:writer:create',
          readOnly: false,
          inputSchema: z.strictObject({}),
          outputSchema: z.strictObject({ done: z.boolean() }),
          execute(_input, context) {
            context.forum.createThread({ title: 'Extension topic', body: 'Content' });
            return { done: true };
          },
        });
      },
    };
    const core = new Community(f.db, { extensions: [{ extension: writerExtension, config: {} }] });
    const admin = { actorId: f.admin.id, scopes: [], channel: 'cli' as const };
    const agent = core.identity.createAgent(admin, {
      name: 'Writable extension actor',
      scopes: ['ext:writer:create', 'forum:write', 'forum:read'],
    });
    const principal = core.identity.authenticateToken(agent.token);
    await expect(
      core.extensions.tool('ext_writer_create')?.execute({}, principal),
    ).resolves.toEqual({
      done: true,
    });
    expect(core.forum.listThreads(principal).items).toHaveLength(1);
  });

  it('advertises the extension to a scoped real MCP client and hides it when disabled', async () => {
    const f = await fixture();
    fixtures.push(f);
    const core = new Community(f.db, { extensions: enabled });
    const admin = { actorId: f.admin.id, scopes: [], channel: 'cli' as const };
    const agent = core.identity.createAgent(admin, {
      name: 'Extension reader',
      scopes: ['ext:example:greet'],
    });
    const server = await listen({ db: f.db, core });
    const client = await connect(server.origin, agent.token);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain('ext_example_greet');
      const response = await client.callTool({
        name: 'ext_example_greet',
        arguments: { subject: 'MCP' },
      });
      expect(response.structuredContent).toEqual({
        greeting: 'Welcome, MCP! (by Extension reader)',
      });
    } finally {
      await client.close();
      await server.close();
    }
    // Same core, no installed extensions: tool not advertised.
    const bare = new Community(f.db);
    expect(bare.extensions.tool('ext_example_greet')).toBeUndefined();
  });
});
