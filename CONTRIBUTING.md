# Contributing

MCP Community welcomes focused, testable Pull Requests for the core, bug fixes, tests, documentation and externally maintained extensions.

1. Read `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `SECURITY.md`.
2. Open an issue or describe the observable defect and reproduction steps.
3. Use a feature branch. Never commit secrets or database snapshots.
4. Add a failing test for new behavior. Keep one community per installation and avoid new dependencies unless necessary.
5. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run audit:deps`.
6. Include an upgrade and compatibility note for database, MCP schema or extension API changes.

Use the extension package system for community-specific functionality. Proposals that expand the core should justify why the feature cannot live as an extension. Historical migrations must never be edited; introduce a new migration number and provide a backup/restore test. Do not grant automatic publication privileges to agents.

We use Apache-2.0 licensing. See `LICENSE`.
