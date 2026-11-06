import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AppError, Community, type Principal } from '@mcp-community/core';
import { openDatabase } from '@mcp-community/database';
import { loadConfiguredExtensions } from './extension-loader.js';

process.umask(0o077);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    username: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'member' },
    as: { type: 'string' },
    scopes: { type: 'string' },
    days: { type: 'string', default: '30' },
    id: { type: 'string' },
    'password-stdin': { type: 'boolean' },
    file: { type: 'string' },
  },
});
const db = openDatabase(process.env.DATABASE_PATH ?? './data/community.sqlite');
const extensions = await loadConfiguredExtensions(
  process.env.EXTENSIONS_FILE ?? './community.extensions.json',
);
const core = new Community(db, { extensions });
const command = positionals[0];
function administrator(): Principal {
  if (!values.as) throw new Error('Use --as with an existing administrator username');
  const actor = core.identity.byUsername(values.as);
  if (!actor) throw new Error('Administrator not found');
  const principal: Principal = { actorId: actor.id, channel: 'cli', scopes: [] };
  core.identity.admin(principal);
  return principal;
}
function password(): string {
  return values['password-stdin']
    ? readFileSync(0, 'utf8').replace(/\r?\n$/, '')
    : randomBytes(24).toString('base64url');
}
try {
  if (command === 'setup' || command === 'user:create') {
    const generated = password();
    const input = {
      username: values.username ?? (command === 'setup' ? 'admin' : ''),
      name: values.name ?? values.username ?? 'Administrator',
      password: generated,
      role: values.role,
    };
    const actor =
      command === 'setup'
        ? await core.identity.bootstrapAdmin({
            username: input.username,
            name: input.name,
            password: generated,
          })
        : await core.identity.createHuman(administrator(), input);
    console.log(
      JSON.stringify(
        {
          id: actor.id,
          username: input.username,
          ...(!values['password-stdin']
            ? {
                password: generated,
                notice: 'Shown once. Store securely; do not commit this output.',
              }
            : {}),
        },
        null,
        2,
      ),
    );
  } else if (command === 'agent:create') {
    const result = core.identity.createAgent(administrator(), {
      name: values.name,
      scopes: (values.scopes ?? 'forum:read,knowledge:read,proposals:read')
        .split(',')
        .map((s) => s.trim()),
      expiresInDays: Number(values.days),
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'token:revoke') {
    core.identity.revokeToken(administrator(), values.id);
    console.log('Token revoked');
  } else if (command === 'db:backup') {
    if (!values.file) throw new Error('Specify an output path using --file');
    await db.backup(values.file);
    console.log('Database backup saved');
  } else if (command === 'db:migrate') {
    db.migrate();
    console.log('Database migrations applied');
  } else {
    console.error(
      'Commands: setup, user:create, agent:create, token:revoke, db:migrate, db:backup',
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof AppError
      ? error.message
      : 'Operation failed. Check command options and database access.',
  );
  process.exitCode = 1;
} finally {
  db.close();
}
