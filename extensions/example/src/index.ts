import type { CommunityExtension } from '@mcp-community/extension-api';
import { z } from 'zod';

/** Minimal sample: install via community.extensions.json; no changes to core required. */
const configSchema = z.strictObject({ greeting: z.string().max(100).default('Hello') });
export const example: CommunityExtension = {
  manifest: {
    id: 'example',
    name: 'Example greeting',
    version: '1.0.0',
    coreApi: '^1.0.0',
    permissions: ['ext:example:greet'],
    configSchema,
  },
  register(registry) {
    registry.registerTool({
      name: 'greet',
      description: 'Say hello to the authenticated actor.',
      requiredScope: 'ext:example:greet',
      readOnly: true,
      inputSchema: z.strictObject({
        subject: z.string().trim().min(1).max(100).default('community'),
      }),
      outputSchema: z.strictObject({ greeting: z.string() }),
      execute(input, ctx) {
        const config = configSchema.parse(ctx.config);
        return { greeting: `${config.greeting}, ${input.subject}! (by ${ctx.actor.name})` };
      },
    });
  },
};
export default example;
