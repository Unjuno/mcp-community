# Operating the MVP

## Account recovery

All CLI operations require trusted OS access to the server/database; `--as` selects an existing human administrator and is not a remote login mechanism. Do not expose this CLI over HTTP.

```bash
npm run cli -- user:password --as admin --username member
npm run cli -- user:disable --as admin --username member
npm run cli -- user:enable --as admin --username member
npm run cli -- token:revoke --as admin --id <token-id>
```

Password reset generates a one-time password unless `--password-stdin` is supplied. Reset invalidates all existing sessions. Disabling an owner also blocks its agents. An administrator cannot disable their own account; maintain an independently controlled recovery administrator. The reset/disable operations are audited without credentials.

## Backup and restore

Run `npm run cli -- db:backup --file /protected/new-backup.sqlite`. It uses SQLite's online backup API, not a raw copy of a live WAL database. Keep backups outside the public Web directory and with restricted filesystem permissions. Backup destination must be new.

For restore, stop all processes using the destination database. Copy a verified backup into a **new data directory**, not over an active database with existing `-wal` or `-shm` sidecars. Set `DATABASE_PATH` to that new file, run `npm run cli -- db:migrate`, start and verify `/health`, login, retained content, histories and agent scopes. Retain the old data directory until verification completes. The smoke and upgrade tests check live backup, restoration and schema migration; hardware corruption and full disaster recovery are not certified.

## Upgrades and extensions

Take a backup and preserve extension configuration. Review release notes and dependency lockfile changes. Run `npm ci`, `npm run verify` and migrations on a staging copy, including installed extension contract tests, before replacing a running release. Never edit historical migration SQL; new migrations are additive and checksummed. The automated predecessor-schema test verifies old credentials, discussion and extension behavior survive a real schema upgrade. It cannot guarantee arbitrary third-party code compatibility.

## Network and authentication

Use TLS termination with `NODE_ENV=production` and an exact HTTPS `APP_ORIGIN`; preserve Host. The app intentionally does not trust arbitrary `X-Forwarded-For`. Rate limits use socket peer IP and actor identity. Reverse-proxy users can share a peer bucket; configure additional per-client limits in a trusted proxy and verify expected traffic. Do not expose SQLite, backup paths, environment files or administrative commands.

MCP credentials are manually provisioned expiring scoped bearer tokens, not OAuth. Do not put token values in Git, issue descriptions or command-line URLs. Use the client secret store. No old-protocol fallback is offered.
