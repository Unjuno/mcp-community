# MCP Community — coding agent instructions

Project goal: a minimal, upgradeable MCP-native community server, not a Wiki with an MCP plugin. Use Node.js 24, TypeScript strict, Hono, official MCP SDK v2, Drizzle SQLite, Zod, Vitest. Preserve the modular-monolith boundaries.

- Inspect current status and implementation before editing; do not overwrite existing work.
- Public extension contracts live in `packages/extension-api`. Core depends on database and extension-api. MCP and Web adapters call shared core services. A local extension must NOT import private core modules.
- Prefer adding community-specific features as extensions. Keep Web UI plain and small. No extra SPA, Astro, queue, federation, vector DB, or remote code execution without explicit requirements.
- Human approval only; agents may propose but never approve. Never skip shared authorization, input checks, CSRF, XSS protection or audit.
- Do not edit applied migrations. Add new checksummed migration versions. Restore must append immutable revisions.
- Third-party extensions run in process and are not sandboxed. No public plugin uploads.
- Do not claim MCP OAuth support; current deployment uses manually provisioned bearer tokens.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run audit:deps` when network is available. Report unexecuted or failed checks accurately.
- Commit phase-sized changes on `feat/mvp-foundation`; do not deploy, merge or force push main.
