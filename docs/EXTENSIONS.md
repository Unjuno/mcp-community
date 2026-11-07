# Developing MCP Community extensions

Extensions are the primary customization mechanism. They add tools to the community MCP server **without modifying core source**. `packages/extension-api` contains the versioned contract shipped in this repository and has no runtime dependency on the core.

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

These packages have **not** been published to the npm registry. For a standalone package, build the repository, run `npm pack --workspace @mcp-community/extension-api --pack-destination /your/artifact/directory`, and install the resulting tarball plus `zod@4.6.7` into your extension project. Pin the reviewed tarball/version; do not assume the package name is available from npm. Build an ES module with a `default` export. Add it to `community.extensions.json` **after independent review**, set `enabled:true`, configure and restart. The server loads a static local file; there is no remote marketplace or Web upload. For the sample already included in the repository:

```json
{
  "extensions": [
    { "package": "@mcp-community/example", "enabled": true, "config": { "greeting": "Hello" } }
  ]
}
```

Provision a scoped agent with `ext:example:greet` and call `ext_example_greet`. With `enabled:false`, the package is not imported, the scope is not granted, and the tool is not advertised. Existing tokens may contain the old scope but cannot invoke a disabled tool.

## Stable public contract and upgrade verification

`CORE_API_VERSION` is a SemVer version of the **public extension contract**, not the
npm package version or the MCP wire protocol version. A `^1.0.0` declaration means
the extension supports compatible `1.x` contract revisions. Core fixes must
preserve these declared methods and semantics until a deliberately announced
major version. The repository remains in the `0.1.x` product release series;
this is a **compatibility policy and automated regression gate**, not a claim
that external security reviews or independent developer studies are complete.

Run `npm run verify:extension` (Node.js 24, npm and `tar`, with a completed
workspace build) before making changes to this API. The command packs the
actual `@mcp-community/extension-api` distribution, verifies its TypeScript
and JavaScript entry points and Apache-2.0 license, then **compiles an unmodified
v1 extension in an isolated package** using that tarball and a separate Zod
installation. It finally loads the compiled extension through the real core,
authenticates a scoped agent and invokes its tool. CI runs this check on every
PR. This validates a fixed v1 contract consumer against the current core; it
does not predict compatibility with unknown future extensions or major APIs.

A tool's `readOnly:true` flag is meaningful for the **provided extension
service facade**: `forum.createThread`, `forum.reply` and `knowledge.propose`
reject mutations with `EXTENSION_READ_ONLY`, even if the actor also holds
base write scopes. Declare `readOnly:false` for every tool that modifies
community state, and grant both its namespaced tool scope and the applicable
base write scope. This protects against accidental mislabeling, **not hostile
in-process JavaScript**. A trusted extension can import arbitrary Node APIs;
review it, pin its dependencies, and never install unreviewed uploads.

## Security and upgrade policy

- An extension declares required scopes; a tool cannot use an undeclared scope. Built-in forum/knowledge methods exposed through `context` also check their own base scopes.
- Inputs **and outputs** have Zod schemas; runtime validates both.
- `coreApi` is matched using SemVer against the current extension contract version (`1.0.0`). An incompatible package stops startup rather than being silently loaded.
- A configuration failure stops startup. Do not catch and ignore it.
- The code runs inside the **same Node.js process**. This is not sandboxing or capability isolation. It can still import built-in Node APIs. Review dependencies and code, pin versions and update deliberately.
- Never accept an extension package name, JS source, or executable URL from an unprivileged HTTP or MCP request.
- Test your package against the supported `coreApi` range and `npm run typecheck && npm test` before distribution. Provide migration and downgrade guidance if you add persistent data.

See the automated contract and HTTP tests in `tests/extensions.test.ts` and upgrade tests in `tests/upgrade.test.ts`.

## Local workspace development

Copy `extensions/example` to `extensions/my-extension`, change its package name, manifest ID, scopes and tool implementation, and keep its `tsconfig.json` references to the extension API. Run `npm install` at the repository root to update the workspace lockfile, then `npm run build`. The build script discovers extension TypeScript projects; no core source edit is required. Configure the new npm package name in `community.extensions.json` and restart. Commit your reviewed extension and lockfile in your community deployment repository. Docker includes all workspace packages, not just the bundled example.

A separately built package can instead be packed and installed with `npm install /path/to/reviewed-extension.tgz --workspace @mcp-community/server`. Preserve that archive or use an approved package registry so `npm ci` remains reproducible.
