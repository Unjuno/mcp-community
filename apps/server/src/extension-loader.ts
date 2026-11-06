import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CommunityExtension, ConfiguredExtension } from '@mcp-community/extension-api';
import { z } from 'zod';

const installed = z.strictObject({
  package: z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
});
const fileSchema = z.strictObject({ extensions: z.array(installed).max(30) });

/** Only local, administrator-reviewed npm packages. Disable skips import entirely. */
export async function loadConfiguredExtensions(path: string): Promise<ConfiguredExtension[]> {
  const data = fileSchema.parse(JSON.parse(readFileSync(resolve(path), 'utf8')));
  const selected = data.extensions.filter((entry) => entry.enabled);
  if (new Set(selected.map((entry) => entry.package)).size !== selected.length)
    throw new Error('Duplicate installed extension package');
  const result: ConfiguredExtension[] = [];
  for (const entry of selected) {
    // Never accept module specifiers from the Web or MCP interface.
    const module = (await import(entry.package)) as { default?: CommunityExtension };
    if (!module.default?.manifest || typeof module.default.register !== 'function')
      throw new Error(`Invalid extension package: ${entry.package}`);
    result.push({ extension: module.default, config: entry.config });
  }
  return result;
}
