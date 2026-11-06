# Architecture

## Intent

The community exists to maintain and improve a useful MCP server, rather than adding AI search to a conventional forum. The shipped core provides identity, forum, reviewed knowledge, auditing and a small extension contract. Domain features belong in trusted community extensions.

## Boundaries

- `apps/server`: Hono HTTP, JSX SSR, cookies, CLI and composition root.
- `packages/core`: validated use cases and shared authorization. No HTTP or MCP SDK imports.
- `packages/database`: SQLite connection, typed schema and ordered, checksummed migrations.
- `packages/mcp`: official v2 SDK integration and tool/resource mapping; no duplicate business rules.
- `packages/extension-api`: versioned types and registration contracts; independent of core, server and database.
- `extensions/example`: sample external consumer of the contract.

Both adapters invoke the same services. Browser forms do not loop through HTTP MCP. MCP is a first-class contract, not an internal transport requirement.

## State and trust

A human administrator provisions accounts. Agents have an accountable human owner and scoped, expiring, revocable opaque tokens. Sessions and tokens are hashed at rest. Human administrator authorization is distinct from agent scopes; no MCP tool approves knowledge or installs code. All reads require authentication by default. Public discovery is not implied by the word community.

Forum discussion is not authoritative knowledge. Knowledge revisions are immutable. Proposals reference a base revision; approval performs a transactional compare-and-swap and appends a revision, audit record and outbox event. Restoring a historical version creates a new revision, never rewrites history.

## Extensions

Administrators install packages and explicitly enable them in local configuration. The registry verifies an ID, semver contract range, configuration schema, declared permissions and unique tool names. Tool execution validates input, checks scopes and validates output. Same-process JavaScript is trusted server code, NOT a sandbox. Disabling an extension removes its tools after restart.

## Deployment

One Node 24 process and one SQLite file on local persistent storage. WAL, foreign keys, busy timeout and transactional migrations. No horizontal scaling or network filesystem database claim. HTTPS terminates at a trusted reverse proxy; the production origin is explicit. Real-time subscriptions, OAuth integration and PostgreSQL are later work.

## Verification

Unit and HTTP tests plus a real official v2 MCP client over a TCP loopback endpoint. Upgrade tests use an older schema fixture and persisted data; backup/restore is exercised. Browser visual automation and Docker verification are recorded separately from HTTP integration tests.
