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

## Not performed / limitations

- Headless Chromium navigation was attempted but blocked with `ERR_BLOCKED_BY_ADMINISTRATOR` by the development environment. No successful visual/browser usability verification is claimed. Browser-form behavior is covered by HTTP integration tests.
- Third-party developer study (three developers, two successful extensions within 90 minutes): **UNCERTAIN / NOT RUN**.
- Independent security review and production deployment: **NOT RUN**.
- No throughput, latency or adoption benchmark is claimed. Automated correctness tests are not a security certification.
