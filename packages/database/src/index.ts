import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3, { type Database as SqliteConnection } from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrateDatabase } from './migrations.js';
import * as schema from './schema.js';

export { migrateDatabase, migrations } from './migrations.js';
export * from './schema.js';

export interface Database {
  sqlite: SqliteConnection;
  orm: BetterSQLite3Database<typeof schema>;
  migrate(): void;
  backup(destination: string): Promise<void>;
  close(): void;
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const sqlite = new BetterSqlite3(path);
  try {
    if (path !== ':memory:') chmodSync(path, 0o600);
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('journal_mode = WAL');
    migrateDatabase(sqlite);
    return {
      sqlite,
      orm: drizzle(sqlite, { schema }),
      migrate: () => migrateDatabase(sqlite),
      backup: async (destination: string) => {
        if (destination === path || existsSync(destination))
          throw new Error('Backup destination must be a new, separate file');
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        await sqlite.backup(destination);
        chmodSync(destination, 0o600);
      },
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
