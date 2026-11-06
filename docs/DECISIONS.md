# Architecture decisions

## ADR-001 — Modular monolith (accepted)

Use Node 24, TypeScript strict, Hono JSX SSR and SQLite. Keep the MCP adapter and extension contract independent. Do not introduce Astro, a SPA or distributed infrastructure for this MVP.

## ADR-002 — Authentication scope (accepted)

Ship browser sessions and manually provisioned scoped bearer tokens. This is NOT an OAuth implementation. Only clients supporting a configured Authorization header can use the MVP; OAuth-only hosts are unsupported until a separately tested standards-based integration is added. MCP wire protocol and authorization interoperability are distinct claims.

## ADR-003 — Human review (accepted)

Only authenticated human administrators through Web/CLI may approve, reject, restore or moderate. Agents cannot self-promote using a tool argument. Reject stale base revisions inside a database transaction. Require independent approval of a proposal.

## ADR-004 — Trusted local extensions (accepted)

An administrator installs local/npm packages and enables them in configuration; restart is sufficient. No web upload, arbitrary remote import, sandbox claim or marketplace. Extension API compatibility is versioned separately from application releases.

## ADR-005 — Empty repository initialization (accepted)

GitHub cannot create a branch without a commit. Create only a README bootstrap on main, then perform all implementation on feat/mvp-foundation. Preserve history; no force push.

## ADR-006 — Execution environment (accepted)

The local container cannot resolve GitHub/npm and starts with Node 22. Use GitHub Actions with Node 24 to resolve exact dependency versions, then attempt offline local validation using a temporary development artifact. Do not pretend unexecuted checks passed.

## ADR-007 — Security boundaries (accepted)

Invite/admin-provisioned accounts, authenticated reads, plain-text escaped posts, synchronizer CSRF tokens and strict Origin checking, Secure cookies in production, persistent rate limits and redacted audit metadata. No raw content or credentials in audit logs. Server content is untrusted data for downstream agents, never instructions.
