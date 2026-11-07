/**
 * Frozen public Extension API v1 consumer. This file must never import private core,
 * database, server, or MCP internals. The release smoke test compiles it in an
 * independent temporary package against the packed extension-api distribution.
 */
import { CORE_API_VERSION, type CommunityExtension } from '@mcp-community/extension-api';
import { z } from 'zod';

const extension: CommunityExtension = {
  manifest: {
    id: 'compat',
    name: 'Standalone v1 contract fixture',
    version: '1.0.0',
    coreApi: '^1.0.0',
    permissions: ['ext:compat:threads'],
    configSchema: z.strictObject({}),
  },
  register(registrar) {
    registrar.registerTool({
      name: 'threads',
      description: 'Read community thread count through the public extension facade.',
      requiredScope: 'ext:compat:threads',
      readOnly: true,
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        count: z.number().int().nonnegative(),
        actor: z.string(),
        contractVersion: z.string(),
      }),
      execute(_input, context) {
        const page = context.forum.listThreads({ page: 1, pageSize: 10 }) as {
          items: unknown[];
        };
        return {
          count: page.items.length,
          actor: context.actor.name,
          contractVersion: CORE_API_VERSION,
        };
      },
    });
  },
};

export default extension;
