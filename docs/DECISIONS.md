# Architecture decision records

## ADR-001: Stack and boundaries

Node 24, TypeScript strict, Hono SSR, official MCP SDK v2.4.0, SQLite with better-sqlite3 and typed Drizzle queries. Keep adapters separate from core use cases and extension contracts. No Astro, SPA or external infrastructure.

## ADR-002: Authentication

Manual scoped bearer tokens are the MVP machine-auth mechanism, NOT OAuth. Only clients capable of setting Authorization headers are supported. Accounts are provisioned by administrators; no public registration. Reads require authentication. MCP protocol compatibility is distinct from OAuth interoperability.

## ADR-003: Knowledge governance

A human administrator via Web/CLI performs approval, rejection and restore. No agent or MCP token may obtain this authority. A proposal author cannot approve their own proposal. Compare base revision and write the new revision, audit and outbox atomically. Restore appends a revision.

## ADR-004: Extensions

Local administrator-reviewed packages; explicit enablement and restart. Semver-checked Core API 1.0.0, namespaced permissions and tool names, validated input/output/config. Same-process code is NOT sandboxed. No upload/remote-code execution interface.

## ADR-005: Delivery environment

Initial repository was empty; initialize main with README only and use feat/mvp-foundation. Since local DNS is unavailable, bootstrap an offline Node 24/dependency kit from GitHub Actions. Use GitHub tools/Actions for authenticated transport; do not invent test results.

## ADR-006: Persistence

SQLite only in this MVP, WAL, foreign keys, busy timeout, checksummed transactional migrations. Migration SQL and typed schema live in the database package. PostgreSQL will require a new database adapter and query review; it is not supported by changing a connection string.

## ADR-007: Defaults

Plain-text, escaped posts; private authenticated community; no themes, wiki or embedded agents. CSRF on every browser mutation; no secrets or content bodies in audit. Rate limits are persistent and do not trust forwarded IP headers.

## ADR-008: Versioned in-process extensions

An extension manifest declares `id`, `name`, `version`, `coreApi`, `permissions` and a Zod configuration schema. Admins enable local packages in a JSON config file; enabled modules import on process startup. A typed registrar converts local tool names into `ext_<namespace>_<tool>` and checks declared scopes before invocation. Extensions are trusted source code, not a sandbox. Rejected alternative: arbitrary packages uploaded from the browser, because that grants remote code execution.

## ADR-009: Backups and upgrades

Use SQLite's consistent backup API, never an uncontrolled filesystem copy of a running WAL database. A restore takes place while the service is stopped and into an empty target directory. `schema_migrations` checksums prevent editing old migrations. Compatibility test restores a captured database into a fresh process and invokes a previously installed extension.

## ADR-010: OAuth and realtime

MCP streamable HTTP v2 uses manually provisioned scoped bearer tokens for this MVP; implementing OAuth correctly requires an external authorization server and interop tests. Realtime update subscriptions are deferred; transactional outbox records are present to support a later independent notifier.

## ADR-011: Explicit proposal read-model state and terminal DB guards

Persist only `pending | approved | rejected`, but project the `conflicted` state from pending proposals whose base revision no longer matches the current resource. Keep the old proposal row immutable; reject (or submit a fresh proposal) rather than silently rewriting old content. A third, additive checksummed SQLite migration prevents resolved-proposal modifications and invalid review transitions. This makes the state projection consistent between Web and MCP without new distributed state or breaking existing status filters.

## ADR-012: Reversible account status, irreversible credentials

Actor disablement is reversible for recovery. Credentials are _not_: disabling an actor revokes their tokens and destroys sessions, and also revokes agent tokens created by disabled humans. Re-enabling requires fresh credentials. Human password reset revokes dependent agent credentials to reduce post-compromise persistence. Explicit token revocations are idempotent. Cost: administrators must re-provision agents after owner reset/disable.

## ADR-013: Forum root moderation and state-aware SSR

A thread's opening post must remain visible when its thread is visible. Reject separate hiding of its opening post; instead let the moderator hide the thread, with Web guidance. Repeated moderation of the same state is a no-op. For UX, retain Hono JSX SSR and adopt semantic status labels, active navigation, keyboard skip link and readable CSS variables; do not introduce Astro or an SPA. A future PostgreSQL adapter must replace SQLite `rowid` ordering with an explicit stable field.

## ADR-014: Public extension compatibility and read-only operation contracts

Preserve the existing API 1.x extension surface independently of the 0.1.x product/package
version. CI must pack the real distributable, check the full Apache-2.0 license
and compile/run a frozen external API v1 fixture against it. Pin the fixture's
source rather than silently adapting it whenever the core changes; an intentional
breaking API change requires a new major contract and explicit migration plan.

Within the public capability facade, a tool declaring `readOnly:true` must
never write threads, replies or knowledge proposals, regardless of its actor's
base write scopes. Reject the attempted transition with `EXTENSION_READ_ONLY`.
This does **not** sandbox trusted in-process Node modules, so reviewing enabled
extensions is still mandatory. Rejected alternative: claim that MCP read-only
annotations alone enforce side-effect freedom.
