# MCP Community Implementation Plan

**Goal:** a self-hosted, MCP-first modular monolith whose trusted extensions survive core upgrades.
**Architecture:** Web and MCP adapters share application services, authorization, SQLite transactions and audit records. Extensions depend only on the public extension API. One instance serves one community.
**Spec:** the owner's Autonomous Implementation Master Prompt, 2026-11-06.

## Repository audit

The repository was empty: contents returned 404, commits returned 409, and no README, license, code or tests existed. A README-only initial commit established `main`; all implementation belongs to `feat/mvp-foundation`. No existing implementation was overwritten.

## Global constraints

Node.js 24 LTS; TypeScript strict; Hono SSR; official MCP TypeScript SDK v2 and 2026-07-28 Streamable HTTP; SQLite only; npm workspaces; Docker; Vitest. No LLM runtime, SPA, federation, marketplace, arbitrary code upload, Redis or vector database. Do not deploy or merge automatically.

## Review focus

- Cross-actor privilege escalation and self-approval through MCP.
- XSS, forged browser requests and secret disclosure in errors/audit.
- Simultaneous proposal approval and immutable revision history.
- Disabled extensions, incompatible contracts and missing scopes.
- Migration replay, backup restoration and preservation of extension behavior.

## Phases and verification

- [x] Phase 0: audit repository; record architecture, threat model and decisions; create branch.
- [ ] Phase 1: workspaces, strict compiler, migrations, health, Docker and CI. Tests: migration idempotence and health.
- [ ] Phase 2: identity, sessions, forum and SSR. Tests: hashes, session rotation, authorization, validation, moderation, rate limits, XSS and CSRF.
- [ ] Phase 3: official v2 MCP adapter. Tests: real HTTP client discovery, tools, resources, posting, restricted/revoked/invalid tokens.
- [ ] Phase 4: resources, revisions, proposals, diff, approval/rejection/restore. Tests: human approval visible over MCP and stale-base rejection.
- [ ] Phase 5: public extension contract and sample. Tests: registration, output validation, permission enforcement, incompatible API and disabled extensions.
- [ ] Phase 6: fresh-install/upgrade/backup/security verification. Tests: migration continuity, extension compatibility, data integrity and dependency audit.
- [ ] Phase 7: README, operational/developer/security guides, final verification and PR.

Each phase records failing tests before implementation, then runs tests, type checking and lint before committing. Failures and unavailable checks are reported rather than labeled successful.

## Execution ledger

2026-11-06: phase 0 started. Local container has Node 22, no Docker and no outbound DNS. GitHub connector can read and write the repository. A temporary bootstrap workflow will resolve official dependencies on Node 24 and provide an offline test kit; production CI will replace it. If unavailable, GitHub Actions remains the test environment.

## Lean validation

Technical PASS requires all mandatory feature, security, data-preservation and extension tests to pass. Third-party usability testing (3 developers; at least 2 complete an extension within 90 minutes) is NOT RUN / UNCERTAIN until independently performed. No demand, performance or security-certification claims are inferred from automated tests.
