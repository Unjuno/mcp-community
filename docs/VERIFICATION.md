# Verification evidence

## Executed locally

Environment: Node.js 24.22.2, Linux x64, SQLite native driver 13.0.3; official MCP server/client SDK 2.4.0. Dependency artifacts were resolved by GitHub Actions and used offline in the sandbox.

- `npm run typecheck`: PASS.
- `npm test`: **47/47 PASS**, 8 files, after review fixes.
- `npm run smoke`: PASS: compiled Node server and CLI, idempotent demo seeding, real modern MCP client, example extension, live SQLite backup and fresh-file restoration.
- `npm run lint`: PASS (Biome; 69 checked files).
- Fault-injection and RED/GREEN tests reproduced then fixed stale-password login during hashing, missing pre-authentication MCP throttling, resource exception disclosure and missing HTML doctype.
- Real predecessor-schema upgrade preserves old credentials, posts and extension execution.

## CI

The security-review commit `6ef5f2f` passed [GitHub Actions run 42170616858](https://github.com/Unjuno/mcp-community/actions/runs/42170616858): clean `npm ci`, strict typecheck, Biome lint, all 47 tests, compiled live-server/MCP/extension/backup smoke test, online `npm audit --audit-level=high`, `docker compose build`, and real non-root container startup, health and migration checks. Earlier baseline run 42168684268 also passed. This verifies the technical MVP in CI; it is not an independent production security certification.

### Explicit state-machine and accessibility review (2026-11-07)

The additive state-machine review commit `183edeb8c9752f9f0a7ab5c6878df061cd14c0d5` passed [GitHub Actions run 42247744336](https://github.com/Unjuno/mcp-community/actions/runs/42247744336) on Node.js 24 / Ubuntu 22.04: `npm ci`, strict TypeScript typecheck, Biome lint (74 checked files), **62/62 tests in 9 files**, compiled real HTTP/MCP/extension/backup smoke, `npm audit --audit-level=high` (zero vulnerabilities), `docker compose build`, live non-root container start, health and SQLite migration checks. The review included 13 explicit state-transition tests and two Web regression tests added beyond the prior 47 tests. The SQLite migration was additive: previous checksummed migrations were preserved.

The standalone local review run observed typecheck, lint and the 13 new transition tests passing, but full local Vitest execution was interrupted by the local sandbox; the complete 62-test result above is verified in CI, not misattributed to local execution. The Docker test environment was ephemeral and cleaned after the job. See [State machines](STATE_MACHINES.md) and [Architecture review](ARCHITECTURE_REVIEW.md).

### Extension API compatibility gate (2026-11-08)

Node.js 24.22.2 / Linux x64: full TypeScript build and test typecheck PASS;
Biome PASS; **64/64 Vitest tests across 9 files PASS**; compiled server/MCP
smoke PASS. A previously missing Apache-2.0 LICENSE in `npm pack --workspace
@mcp-community/extension-api` was reproduced as a failing artifact check and
corrected. `npm run verify:extension` now PASS: inspected packed JS/TypeScript
and LICENSE, built a separate frozen v1 extension with its own Zod package, then
registered/invoked it via the current core with scoped credentials.

Two new regression tests confirmed that a read-only tool cannot mutate through
the forum/knowledge facades even if its actor has write scopes, while a declared
writable tool still works. The first test failed before the patch and passed
afterwards. [GitHub CI run 42400348840](https://github.com/Unjuno/mcp-community/actions/runs/42400348840) for commit `6cc8eab2`: **PASS** — clean `npm ci`, strict TypeScript typecheck, lint, all **64 tests**, independently compiled packed extension API contract check, compiled MCP smoke, online `npm audit --audit-level=high`, Docker image build, non-root container startup, health, migrations and authenticated MCP thread/reply persistence after container recreation. CI was ephemeral and cleaned its data volume. This is technical regression evidence, not an independent security certification.

### Durable MCP mutation receipts (2026-11-08)

Local Node.js **24.22.2**, Linux x64, SQLite driver 13.0.3:
`npm run typecheck` PASS; `npm run lint` PASS without warnings;
`npm test` **72/72 PASS across 10 files**;
`npm run verify:extension` PASS (independently compiled frozen public API
v1 extension); `npm run smoke` PASS (compiled server and official MCP client,
extension invocation, SQLite backup/restore).

New regression cases cover: repeated forum thread/reply or knowledge-proposal
requests return the original result without duplicate data/audit/outbox;
reusing a key with altered input fails with `IDEMPOTENCY_CONFLICT`; distinct
actors or operations are independent; revoked credentials cannot replay;
receipts survive a database close/reopen; a synthetic audit insert failure
rolls back the mutation and receipt; a real MCP v2 client can retry both thread
and proposal tools; a real v3 SQLite database upgrades to migration 4 while
preserving existing records. All tests are automated, not simulated results.

[GitHub Actions run 42402490283](https://github.com/Unjuno/mcp-community/actions/runs/42402490283) for commit `b5c58793` **PASS**: clean `npm ci`, strict typecheck, lint, **72/72 tests**, independently packed extension API contract check, compiled MCP smoke, online high-severity dependency audit, Docker Compose build, non-root container startup/health/migrations, and authenticated MCP forum write/reply persistence after container recreation. CI used an ephemeral container and removed the test volume. See this run for the exact verification record.

## Not performed / limitations

- Headless Chromium navigation was attempted but blocked with `ERR_BLOCKED_BY_ADMINISTRATOR` by the development environment. No successful visual/browser usability verification is claimed. Browser-form behavior is covered by HTTP integration tests.
- Third-party developer study (three developers, two successful extensions within 90 minutes): **UNCERTAIN / NOT RUN**.
- Independent security review and production deployment: **NOT RUN**.
- No throughput, latency or adoption benchmark is claimed. Automated correctness tests are not a security certification.
