import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

export interface Migration {
  id: number;
  sql: string;
}
export const migrations: readonly Migration[] = [
  {
    id: 1,
    sql: `
CREATE TABLE actors (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('human','agent')),
 role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
 owner_id TEXT REFERENCES actors(id), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), created_at TEXT NOT NULL,
 CHECK(kind = 'human' OR (role = 'member' AND owner_id IS NOT NULL))
);
CREATE TABLE users (actor_id TEXT PRIMARY KEY REFERENCES actors(id), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE sessions (hash TEXT PRIMARY KEY, actor_id TEXT REFERENCES actors(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE tokens (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id), hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at TEXT NOT NULL);
CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id), hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), created_at TEXT NOT NULL, bumped_at TEXT NOT NULL);
CREATE INDEX threads_bumped_idx ON threads(bumped_at, id);
CREATE TABLE posts (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), actor_id TEXT NOT NULL REFERENCES actors(id), body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)), created_at TEXT NOT NULL);
CREATE INDEX posts_thread_idx ON posts(thread_id, created_at, id);
CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE outbox_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);
`,
  },
  {
    id: 2,
    sql: `
CREATE TABLE knowledge_resources (
 id TEXT PRIMARY KEY, current_revision INTEGER NOT NULL CHECK(current_revision >= 0),
 created_by TEXT NOT NULL REFERENCES actors(id), updated_by TEXT NOT NULL REFERENCES actors(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE knowledge_revisions (
 resource_id TEXT NOT NULL REFERENCES knowledge_resources(id), number INTEGER NOT NULL CHECK(number > 0),
 title TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES actors(id),
 reviewer_id TEXT NOT NULL REFERENCES actors(id), reason TEXT NOT NULL, restored_from INTEGER, created_at TEXT NOT NULL,
 PRIMARY KEY(resource_id, number)
);
CREATE TRIGGER knowledge_revision_no_update BEFORE UPDATE ON knowledge_revisions BEGIN SELECT RAISE(ABORT, 'Knowledge revisions are immutable'); END;
CREATE TRIGGER knowledge_revision_no_delete BEFORE DELETE ON knowledge_revisions BEGIN SELECT RAISE(ABORT, 'Knowledge revisions are immutable'); END;
CREATE TABLE proposals (
 id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES knowledge_resources(id), base_revision INTEGER NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL, note TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES actors(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewer_id TEXT REFERENCES actors(id), decision_note TEXT, reviewed_at TEXT, created_at TEXT NOT NULL,
 FOREIGN KEY(resource_id, base_revision) REFERENCES knowledge_revisions(resource_id, number)
);
CREATE INDEX proposals_status_idx ON proposals(status, created_at);
`,
  },
];

export function migrateDatabase(sqlite: BetterSqlite3.Database, selected = migrations): void {
  sqlite
    .transaction(() => {
      sqlite.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, checksum TEXT NOT NULL)',
      );
      const applied = sqlite
        .prepare('SELECT id, checksum FROM schema_migrations ORDER BY id')
        .all() as { id: number; checksum: string }[];
      for (const previous of applied) {
        const known = selected.find((m) => m.id === previous.id);
        if (!known || checksum(known.sql) !== previous.checksum)
          throw new Error(
            'Unsupported or modified database migration; restore the correct application release',
          );
      }
      let last = 0;
      for (const migration of selected) {
        if (migration.id <= last) throw new Error('Migrations must have strictly increasing IDs');
        last = migration.id;
        if (!applied.some((m) => m.id === migration.id)) {
          sqlite.exec(migration.sql);
          sqlite
            .prepare('INSERT INTO schema_migrations(id, checksum) VALUES (?, ?)')
            .run(migration.id, checksum(migration.sql));
        }
      }
    })
    .immediate();
}
function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}
