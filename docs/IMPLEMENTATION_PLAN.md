# MCP Community Implementation Plan

Goal: build the owner's specified MCP-first modular monolith, not only a design.
Architecture: Hono and MCP adapters call the same authorized services. Trusted extensions depend only on the public contract. One community per SQLite database.

## Audit and environment

The remote repository was empty (contents 404, history 409). README initialized main; all implementation is on feat/mvp-foundation. No license or existing code was present. GitHub connector is authorized for changes. Local outbound DNS is unavailable; official dependencies and Node 24.22.2 were obtained from successful GitHub Actions run 42163595307. Tests were executed locally against that offline toolchain and again in GitHub Actions.

## Phase ledger

- [x] Phase 0: audit, scope and architecture recorded remotely.
- [x] Phase 1: workspaces, health, typed SQLite, managed migrations, Docker and CI.
- [x] Phase 2: identity, sessions, shared authorization, forum and SSR.
- [x] Phase 3: official MCP v2 tools/resources and real-client HTTP tests.
- [x] Phase 4: knowledge revisions, proposals, conflict detection and human approval.
- [x] Phase 5: external extension contract, registry and sample.
- [x] Phase 6: upgrade, restore, authorization checks, dependency audit and Docker build verified by GitHub CI.
- [x] Phase 7: operator/developer guides, final tests, source publication and PR #1 (external developer trial remains pending).

## Verification rules

Each feature starts with a failing behavior test, followed by minimal implementation, full tests, type checking and lint. Runtime assumptions: Node 24, Linux x64 for the native SQLite dependency, single application process, local disk. Changes are committed by phase. No deployment, merge, force push or unreviewed arbitrary code execution.

## Review focus

Cross-actor authority; browser CSRF/XSS; duplicate approvals and stale revisions; disabled/incompatible extensions; upgrade and backup data integrity. Explicitly test each rather than inferring correctness from happy paths.

## Lean experiment

H: a third party can add a scoped tool without editing the core and preserve it across core upgrades.
T: automated contract/migration tests, then a separate study with three developers.
D: all mandatory technical tests PASS; third-party threshold is two of three completing within 90 minutes. Unperformed tests are UNCERTAIN.
C: the extension API and forum may be less useful than an ordinary SDK repository.
U: experience, dependency versions and environment differences. No performance or demand conclusions before measurement.

Phase 1: observed 2 RED tests, implemented foundation, then 2/2 PASS; strict typecheck and Biome PASS. Explicit Database return type fixed an unnameable inferred native-driver declaration. Docker configuration created but not yet executed locally (Docker unavailable).

Phase 2: 15 new RED tests preceded implementation; all 17 tests now PASS, strict typecheck and Biome PASS. Implemented scrypt credentials, hashed sessions/tokens, scoped agents, revocation, shared authorization, persistent rate limits, forum pagination/moderation, escaped SSR, session rotation and synchronizer-CSRF checks. CLI setup and account/agent provisioning added.

Phase 3: official @modelcontextprotocol/server and /client 2.4.0; modern 2026-07-28 negotiation pinned in real TCP tests. 22 tests passed; typecheck and lint passed. No OAuth or legacy-client compatibility claimed. Resource discovery lists the most recent 100 threads; tools provide full pagination. Node fetch normalizes Host, so hostile Host tests use node:http.

Phase 4: seven RED knowledge/proposal tests preceded implementation. 29/29 local tests PASS. TypeScript strict typecheck and Biome lint PASS. Knowledge revisions immutable in SQLite, approval transaction checks current revision and rejects self-approval; browser diff is escaped and uses synchronizer CSRF. Docker still untested.

Phase 5: typed extension contract and manifest, explicit local enablement, namespace/scope/schema validation, example package and real MCP-client invocation. Five extension contract tests PASS; disabled plugins do not appear in runtime registry. The local loader has no upload endpoint. Review before installing any package; execution is in-process.

Phase 6: SQLite backup API and `db:backup` CLI, upgrade/restore migration tests and extension tool access on a restored DB. Two upgrade tests PASS. GitHub Actions CI run 42168390881 passed `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (36/36), `npm audit --audit-level=high`, and `docker compose build`. Local Docker is unavailable; no public deployment performed. Static token + Node 24 support; no OAuth claim.

Phase 7: README, AGENTS, CONTRIBUTING, SECURITY, Apache-2.0 LICENSE, extension and architecture guides delivered. GitHub branch `feat/mvp-foundation` synchronized without force; [Pull Request #1](https://github.com/Unjuno/mcp-community/pull/1) opened. Local live-process smoke: `GET /health` = 200, anonymous `/` = 303, `/login` = 200, uncredentialed `POST /mcp` = 401. GitHub CI [run 42168390881](https://github.com/Unjuno/mcp-community/actions/runs/42168390881) passed. Technical MVP acceptance: **PASS**. External independent-developer usability (three participants within 90 minutes): **UNCERTAIN / not performed**. Production hardening and user adoption are not certified.

## Final security and operations review

Preserved the existing published implementation and reviewed it in an isolated worktree. Added narrowly scoped improvements rather than replacing the extension contract or knowledge schema: password recovery/session invalidation, stale-hash login rejection, peer-address throttling, resource error redaction, standards-mode HTML, repeatable demo data, custom-workspace build inclusion, real predecessor-schema upgrade testing and compiled-release smoke tests. 47/47 local tests now pass. Browser navigation was blocked by environment policy and remains unverified. Expanded CI now includes actual container startup, health, non-root identity and migration execution. See `VERIFICATION.md` for the final CI evidence.

## State-machine audit and review branch (2026-11-06)

This is a backward-compatible review of the existing MVP, not a new feature tier.

- [x] Extract hidden state transitions from proposals, revisions, accounts, tokens, sessions, moderation, extensions and outbox.
- [x] Add explicit proposal-state projection and publication transition guards in shared core.
- [x] Reject stale proposals at submission; present conflicts consistently in Web and MCP.
- [x] Add append-only migration 3 for terminal proposal immutability.
- [x] Make credential invalidation terminal across disable/reactivate and owner reset.
- [x] Make duplicate revocation/moderation idempotent; protect forum opening posts.
- [x] Emit proposal-resolution and knowledge-update outbox rows in one approval transaction.
- [x] Improve Web accessibility and state-aware review without an SPA or new runtime dependency.
- [x] Write `docs/STATE_MACHINES.md` and `docs/ARCHITECTURE_REVIEW.md`.
- [x] Record current review branch CI (typecheck, lint, tests, smoke, migration, container): [run 42247744336](https://github.com/Unjuno/mcp-community/actions/runs/42247744336), **62/62 PASS**.
- [ ] External security review and 3-developer usability experiment (outside automated scope).

The prior local **47 tests** were retained, plus new lifecycle and Web accessibility tests.
GitHub Actions confirmed **62/62 tests** across 9 files, Node 24 typecheck, Biome, MCP/extension/backup smoke, high-severity dependency audit, Docker build and live non-root container migration. The three-developer usability study, independent security assessment, and production deployment remain **UNCERTAIN / NOT RUN**.
