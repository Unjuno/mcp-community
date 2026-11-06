import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Community } from '@mcp-community/core';
import { migrateDatabase, migrations, openDatabase } from '@mcp-community/database';
import { example } from '@mcp-community/example';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../packages/core/src/crypto.js';
import { PASSWORD } from './helpers.js';

const config = [{ extension: example, config: { greeting: 'Welcome' } }];

describe('backup, migration, core upgrade and extension compatibility', () => {
  it('backs up and restores users, knowledge and extension behavior without data loss', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcc-upgrade-'));
    const path = join(directory, 'active.sqlite');
    const backup = join(directory, 'backup.sqlite');
    let db = openDatabase(path);
    try {
      const original = new Community(db, { extensions: config });
      const admin = await original.identity.bootstrapAdmin({
        username: 'admin',
        name: 'Administrator',
        password: 'Tests-only-strong-passphrase!',
      });
      const principal = { actorId: admin.id, scopes: [], channel: 'cli' as const };
      const thread = original.forum.createThread(principal, {
        title: 'Upgrade check',
        body: 'Preserve this message',
      });
      original.knowledge.create(principal, {
        id: 'upgrade-check',
        title: 'Upgrade document',
        body: 'Keep revisions',
        sources: [],
      });
      const token = original.identity.createAgent(principal, {
        name: 'Agent',
        scopes: ['forum:read', 'knowledge:read', 'ext:example:greet'],
      });
      await db.backup(backup);
      await expect(db.backup(backup)).rejects.toThrow(/new, separate/);
      db.close();
      db = openDatabase(backup);
      db.migrate();
      const upgraded = new Community(db, { extensions: config });
      const authenticated = upgraded.identity.authenticateToken(token.token);
      expect(upgraded.forum.getThread(authenticated, { id: thread.id }).posts[0]?.body).toBe(
        'Preserve this message',
      );
      expect(upgraded.knowledge.get(authenticated, { id: 'upgrade-check' }).body).toBe(
        'Keep revisions',
      );
      expect(upgraded.knowledge.history(authenticated, { id: 'upgrade-check' }).items).toHaveLength(
        1,
      );
      await expect(
        upgraded.extensions
          .tool('ext_example_greet')
          ?.execute({ subject: 'upgrade' }, authenticated),
      ).resolves.toEqual({ greeting: 'Welcome, upgrade! (by Agent)' });
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates a real version-1 database and preserves existing discussion and credentials', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcc-predecessor-'));
    const path = join(directory, 'old.sqlite');
    const old = new BetterSqlite3(path);
    const actorId = randomUUID();
    const threadId = randomUUID();
    const time = new Date().toISOString();
    migrateDatabase(old, migrations.slice(0, 1));
    old
      .prepare(
        "INSERT INTO actors(id,name,kind,role,disabled,created_at) VALUES(?,?,'human','admin',0,?)",
      )
      .run(actorId, 'Legacy administrator', time);
    old
      .prepare('INSERT INTO users(actor_id,username,password_hash) VALUES(?,?,?)')
      .run(actorId, 'legacy', await hashPassword(PASSWORD));
    old
      .prepare(
        'INSERT INTO threads(id,title,actor_id,hidden,created_at,bumped_at) VALUES(?,?,?,0,?,?)',
      )
      .run(threadId, 'Existing discussion', actorId, time, time);
    old
      .prepare(
        'INSERT INTO posts(id,thread_id,actor_id,body,hidden,created_at) VALUES(?,?,?,?,0,?)',
      )
      .run(randomUUID(), threadId, actorId, 'Keep existing content', time);
    old.close();
    const db = openDatabase(path);
    try {
      const upgraded = new Community(db, { extensions: config });
      const session = await upgraded.identity.login(
        { username: 'legacy', password: PASSWORD },
        'upgrade-test',
      );
      const principal = upgraded.identity.session(session.token)?.principal ?? null;
      expect(upgraded.forum.getThread(principal, { id: threadId }).posts[0]?.body).toBe(
        'Keep existing content',
      );
      const token = upgraded.identity.createAgent(principal, {
        name: 'Upgrade agent',
        scopes: ['ext:example:greet'],
      });
      await expect(
        upgraded.extensions
          .tool('ext_example_greet')
          ?.execute({ subject: 'migration' }, upgraded.identity.authenticateToken(token.token)),
      ).resolves.toEqual({ greeting: 'Welcome, migration! (by Upgrade agent)' });
      expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({
        n: migrations.length,
      });
      db.migrate();
      expect(db.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses modified or unknown historical migrations', () => {
    const db = openDatabase(':memory:');
    try {
      expect(() =>
        migrateDatabase(
          db.sqlite,
          migrations.map((migration) =>
            migration.id === 1 ? { ...migration, sql: `${migration.sql}\n-- edited` } : migration,
          ),
        ),
      ).toThrow(/Unsupported or modified/);
      expect(() => migrateDatabase(db.sqlite, migrations.slice(0, 1))).toThrow(
        /Unsupported or modified/,
      );
    } finally {
      db.close();
    }
  });
});
