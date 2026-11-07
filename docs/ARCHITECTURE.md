# Architecture v0.1 (MVP, state-machine review 2026-11-06)

## Intent and boundaries

One installation equals one community. MCP is the primary machine interface; Web SSR is the human interface. Both call the same application services with the **authenticated Principal**. The product is not a Wiki with an MCP wrapper: the objective is ongoing MCP improvement via community discussion, reviewed data, and externally authored tools.

```text
human browser -- Hono SSR / forms ---+
                                     |  input validation, shared policy, audit
MCP client ------ v2 HTTP adapter --+--> Community --> Forum, Identity, Knowledge, Proposals
                                           |                          |
                                           +-- ExtensionRegistry      |
                                           |                          |
                                           +-- SQLite + revisions + outbox
```

The MCP adapter uses `@modelcontextprotocol/server` v2, not custom JSON-RPC. The MCP server is constructed per authenticated request, and resources and tools delegate to shared core services. All data produced by humans and agents is untrusted content; it never has authority to modify runtime instructions.

## Packages and dependencies

- `apps/server`: Hono HTTP, Cookie/session, CSRF, SSR and CLI. Depends on core, MCP and extension loader.
- `packages/core`: `Community`, `Runtime`, `Identity`, `Forum`, `Knowledge`, `ExtensionRegistry`. Depends on database and extension-api only.
- `packages/database`: Drizzle SQLite schema, checksummed migrations, WAL, backup.
- `packages/mcp`: official SDK v2 binding; registers MCP tools and resource templates.
- `packages/extension-api`: public TypeScript definitions; depends on Zod only. **Never imports the core.**
- `extensions/example`: sample package using only `extension-api`.

`@mcp-community/core` has no dependency on `@mcp-community/mcp`, Hono or the UI. Moving the UI or changing MCP transport must not require rewriting the domain services.

## Durable retry receipts

MCP `forum_create_thread`, `forum_reply`, and `knowledge_propose_update` accept
an optional UUID `idempotencyKey`; legacy callers can omit it. Core services
use a single SQLite `BEGIN IMMEDIATE` transaction for the mutation, audit,
outbox, and corresponding immutable receipt. A retry by the same authorized
actor with the same normalized request returns the original result; a changed
request with the same key fails with `IDEMPOTENCY_CONFLICT`. This improves
at-most-once **effect** on keyed writes without claiming exactly-once network
delivery. The normal role/scope/expiry check always runs, and rate-limiting
still applies to retries.

Migration 4 adds `mutation_receipts`, separate from MCP transport state and
extension API. It is additive and checksummed, so previously installed
extension packages do not need changing. Receipt storage is currently
permanent; operators must monitor database size. See [State machines](STATE_MACHINES.md)
and [ADR-015](DECISIONS.md).

## Identity & authorization

`actors` identify humans and agents. Agents belong to a human administrator and are provisioned, scoped and revoked by that administrator. The `Runtime.require` function authorizes every service call, independently of which adapter is used. Browser writes require a session, exact expected Origin, synchronizer CSRF token and form content type. MCP writes require a hashed-at-rest Bearer credential, scopes and expiry/revocation checks. Admin approvals require **human + role=admin + Web/CLI channel**, never agent. Different human administrators can review proposals but the author cannot approve their own proposal.

Do not add OAuth claims until a proper authorization server and client interop tests are implemented. TLS is mandatory for production exposed tokens; Hono checks configured Host to mitigate DNS rebinding.

## Persistence and consistency

SQLite with foreign keys, WAL and busy timeout. All knowledge publications, review decisions, immutable revisions, audit rows and event-outbox rows are created in an `IMMEDIATE` transaction. `knowledge_revisions` has DB triggers preventing updates/deletes; a restore appends a new revision. Two proposals against the same base may exist; second approval fails with `REVISION_CONFLICT` after first is approved. Migrations have sequential IDs and SHA-256 checksums, verified when opening the database. **Never edit a published migration; add a new numbered migration.**

State transitions and projected read states are specified in [State machines](STATE_MACHINES.md); review findings and UX decisions are in [Architecture review](ARCHITECTURE_REVIEW.md). Migration 3 enforces terminal proposal decisions in SQLite, and actor disablement permanently revokes credentials.

No distributed event bus or subscriptions are required in MVP. `outbox_events` records change intent and permits later delivery without making synchronous notification a correctness condition.

## Extension contract

Admin installs a local npm workspace/package, then adds it to `community.extensions.json` and restarts. Only `enabled:true` packages are imported. The runtime validates package manifests (unique ID/name, semver/core API compatibility, declared extension-prefixed permission scopes), Zod config schemas, unique names and input/output schemas. Each namespaced tool calls `Runtime.require` before `execute`. Built-in community service methods provided through the execution context **also perform their own scope checks**.

The stable TypeScript interface `CommunityExtension.register(registry)` declares tools. Sample: `ext_example_greet` / `ext:example:greet`. Version of this contract is `CORE_API_VERSION = 1.0.0`, distinct from the MCP protocol version. Trusted extensions can still import Node libraries, open files or access the network: the in-process extension API is **not a security sandbox**. No Web upload/execution.

## Runtime and deployment assumptions

Node.js 24, TypeScript strict, one process, npm workspaces, native `better-sqlite3` compiled for matching ABI, SQLite data on persistent local storage. Docker image runs as non-root, disables additional capabilities and mounts database volume. HTTP port is local by default; production HTTPS is terminated by a separately configured reverse proxy. Redis/PostgreSQL/HA are out of scope. A PostgreSQL driver swap alone is insufficient; schema/query/transaction compatibility needs separate implementation.

## Failure recovery

1. Make a consistent SQLite backup with the CLI before upgrading.
2. Record installed extension versions and config, run tests on a copy.
3. Run migration in staging, verify forum/knowledge/admin and MCP tool calls.
4. If failure occurs, stop server, restore backup to a **clean** data directory, restore matching app/extension versions, restart and rerun health/tests.

See [Security model](SECURITY_MODEL.md), [ADR log](DECISIONS.md), and [Implementation plan](IMPLEMENTATION_PLAN.md).
