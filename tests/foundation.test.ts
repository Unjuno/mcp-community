import { migrations, openDatabase } from '@mcp-community/database';
import { describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';

describe('foundation', () => {
  it('applies migrations once and enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    try {
      expect(db.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      const first = db.sqlite.prepare('select count(*) as n from schema_migrations').get();
      db.migrate();
      expect(db.sqlite.prepare('select count(*) as n from schema_migrations').get()).toEqual(first);
      expect(first).toEqual({ n: migrations.length });
    } finally {
      db.close();
    }
  });
  it('returns a minimal health response without secrets', async () => {
    const db = openDatabase(':memory:');
    try {
      const app = createApp({ db, origin: 'http://localhost:3000', production: false });
      const response = await app.request('http://localhost:3000/health');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    } finally {
      db.close();
    }
  });
});
