# Developing MCP Community extensions

Extensions are the primary customization mechanism. They add tools to the community MCP server **without modifying core source**. `packages/extension-api` is the published contract and has no runtime dependency on the core.

## Example

Study `extensions/example/src/index.ts`. The package exports a default `CommunityExtension` object with a typed manifest and `register(registrar)` function. The included sample registers one Zod-validated, read-only `greet` tool. A tool must declare a scope prefixed with `ext:<extension-id>:`. The MCP tool is namespaced as `ext_<extension-id>_<tool-name>` (hyphens become underscores).

A minimal custom module looks like:

```ts
import type { CommunityExtension } from '@mcp-community/extension-api';
import { z } from 'zod';

const myExtension: CommunityExtension = {
  manifest: {
    id: 'sample',
    name: 'Sample',
    version: '1.0.0',
    coreApi: '^1.0.0',
    permissions: ['ext:sample:hello'],
    configSchema: z.strictObject({}),
  },
  register(registry) {
    registry.registerTool({
      name: 'hello',
      description: 'Hello from the sample extension',
      requiredScope: 'ext:sample:hello',
      readOnly: true,
      inputSchema: z.strictObject({ message: z.string().max(80) }),
      outputSchema: z.strictObject({ result: z.string() }),
      execute(input, context) {
        return { result: `${context.actor.name}: ${input.message}` };
      },
    });
  },
};
export default myExtension;
```

For a standalone npm package, declare `@mcp-community/extension-api` and `zod` dependencies. Build an ES module with a `default` export. Add it to `community.extensions.json` **after independent review**, set `enabled:true`, configure and restart. The server loads a static local file; there is no remote marketplace or Web upload. For the sample already included in the repository:

```json
{
  "extensions": [
    { "package": "@mcp-community/example", "enabled": true, "config": { "greeting": "Hello" } }
  ]
}
```

Provision a scoped agent with `ext:example:greet` and call `ext_example_greet`. With `enabled:false`, the package is not imported, the scope is not granted, and the tool is not advertised. Existing tokens may contain the old scope but cannot invoke a disabled tool.

## Security and upgrade policy

- An extension declares required scopes; a tool cannot use an undeclared scope. Built-in forum/knowledge methods exposed through `context` also check their own base scopes.
- Inputs **and outputs** have Zod schemas; runtime validates both.
- `coreApi` is matched using SemVer against the current extension contract version (`1.0.0`). An incompatible package stops startup rather than being silently loaded.
- A configuration failure stops startup. Do not catch and ignore it.
- The code runs inside the **same Node.js process**. This is not sandboxing or capability isolation. It can still import built-in Node APIs. Review dependencies and code, pin versions and update deliberately.
- Never accept an extension package name, JS source, or executable URL from an unprivileged HTTP or MCP request.
- Test your package against the supported `coreApi` range and `npm run typecheck && npm test` before distribution. Provide migration and downgrade guidance if you add persistent data.

See the automated contract and HTTP tests in `tests/extensions.test.ts` and upgrade tests in `tests/upgrade.test.ts`.
