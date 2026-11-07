import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Community } from '@mcp-community/core';
import { openDatabase } from '@mcp-community/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Fixture, fixture, PASSWORD } from './helpers.js';

const keyA = '123e4567-e89b-42d3-a456-426614174000';
const keyB = '123e4567-e89b-42d3-a456-426614174001';
let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => f.db.close());

const rows = (table: string) => {
  if (!['threads', 'posts', 'proposals', 'audit_logs', 'outbox_events'].includes(table))
    throw new Error('Unexpected test table');
  return (f.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
};

describe('idempotent MCP mutation receipts', () => {
  it('returns an identical thread receipt without duplicating posts, audit or outbox', () => {
    const input = { title: 'Retry', body: 'Stable content', idempotencyKey: keyA };
    const existingAudits = rows('audit_logs'); // setup already audited bootstrap/users
    const first = f.core.forum.createThread(f.memberContext, input);
    const second = f.core.forum.createThread(f.memberContext, input);
    expect(second).toEqual(first);
    expect(rows('threads')).toBe(1);
    expect(rows('posts')).toBe(1);
    expect(rows('outbox_events')).toBe(1);
    expect(rows('audit_logs')).toBe(existingAudits + 1);
  });

  it('rejects conflicting key reuse and permits independent actors or different operations', () => {
    const first = f.core.forum.createThread(f.memberContext, {
      title: 'First',
      body: 'Original',
      idempotencyKey: keyA,
    });
    expect(() =>
      f.core.forum.createThread(f.memberContext, {
        title: 'Changed',
        body: 'Different',
        idempotencyKey: keyA,
      }),
    ).toThrowError(expect.objectContaining({ status: 409, code: 'IDEMPOTENCY_CONFLICT' }));
    const other = f.core.forum.createThread(f.adminContext, {
      title: 'Other actor',
      body: 'Allowed',
      idempotencyKey: keyA,
    });
    expect(other.id).not.toBe(first.id);
    expect(rows('threads')).toBe(2);
    const reply = f.core.forum.reply(f.memberContext, {
      threadId: first.id,
      body: 'Reply',
      idempotencyKey: keyA,
    });
    expect(
      f.core.forum.reply(f.memberContext, {
        threadId: first.id,
        body: 'Reply',
        idempotencyKey: keyA,
      }),
    ).toEqual(reply);
    expect(rows('posts')).toBe(3);
  });

  it('returns original proposal receipt after publication rather than creating stale duplicates', () => {
    f.core.knowledge.create(f.adminContext, {
      id: 'retry-note',
      title: 'Initial',
      body: 'First',
      sources: [],
    });
    const input = {
      id: 'retry-note',
      baseRevision: 1,
      title: 'Updated',
      body: 'Second',
      sources: [],
      note: 'Fix',
      idempotencyKey: keyB,
    };
    const proposal = f.core.knowledge.propose(f.memberContext, input);
    f.core.knowledge.approve(f.adminContext, { id: proposal.id });
    const repeated = f.core.knowledge.propose(f.memberContext, input);
    expect(repeated).toEqual(proposal);
    expect(rows('proposals')).toBe(1);
    expect(f.core.knowledge.get(f.memberContext, { id: 'retry-note' }).currentRevision).toBe(2);
    expect(() =>
      f.core.knowledge.propose(f.memberContext, { ...input, note: 'Different' }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('does not let receipts bypass access-token revocation or schema validation', () => {
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Retrying agent',
      scopes: ['forum:write'],
    });
    const principal = f.core.identity.authenticateToken(issued.token);
    const input = { title: 'Agent', body: 'Authenticated', idempotencyKey: keyA };
    f.core.forum.createThread(principal, input);
    f.core.identity.revokeToken(f.adminContext, issued.tokenId);
    expect(() => f.core.forum.createThread(principal, input)).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
    expect(() =>
      f.core.forum.createThread(f.memberContext, {
        title: 'Bad key',
        body: 'Body',
        idempotencyKey: 'not-a-uuid',
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(rows('threads')).toBe(1);
  });

  it('rolls back both the write and receipt when audit insertion fails', () => {
    const input = { title: 'Atomic write', body: 'No partial result', idempotencyKey: keyA };
    f.db.sqlite.exec(`
      CREATE TRIGGER fail_forum_audit BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'forum.create_thread'
      BEGIN SELECT RAISE(ABORT, 'Simulated audit failure'); END;
    `);
    expect(() => f.core.forum.createThread(f.memberContext, input)).toThrow(
      'Simulated audit failure',
    );
    expect(rows('threads')).toBe(0);
    expect(rows('posts')).toBe(0);
    expect(rows('outbox_events')).toBe(0);
    expect(
      (f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM mutation_receipts').get() as { n: number }).n,
    ).toBe(0);
    f.db.sqlite.exec('DROP TRIGGER fail_forum_audit');
    const committed = f.core.forum.createThread(f.memberContext, input);
    expect(f.core.forum.createThread(f.memberContext, input)).toEqual(committed);
    expect(rows('threads')).toBe(1);
    expect(
      (f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM mutation_receipts').get() as { n: number }).n,
    ).toBe(1);
  });

  it('persists a receipt across a real SQLite close/reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcc-retry-'));
    const path = join(dir, 'community.sqlite');
    try {
      const originalDb = openDatabase(path);
      let originalToken = '';
      let first: { id: string; actorId: string } | undefined;
      try {
        const core = new Community(originalDb);
        const admin = await core.identity.bootstrapAdmin({
          username: 'persistadmin',
          name: 'Persist admin',
          password: PASSWORD,
        });
        const issued = core.identity.createAgent(
          { actorId: admin.id, channel: 'cli', scopes: [] },
          {
            name: 'Persist agent',
            scopes: ['forum:write'],
          },
        );
        originalToken = issued.token;
        first = core.forum.createThread(core.identity.authenticateToken(originalToken), {
          title: 'Across restart',
          body: 'Data remains',
          idempotencyKey: keyA,
        });
      } finally {
        originalDb.close();
      }
      if (!originalToken || !first) throw new Error('Persisted receipt fixture was not created');
      const afterRestart = openDatabase(path);
      try {
        const core = new Community(afterRestart);
        const replay = core.forum.createThread(core.identity.authenticateToken(originalToken), {
          title: 'Across restart',
          body: 'Data remains',
          idempotencyKey: keyA,
        });
        expect(replay).toEqual(first);
        expect(
          (afterRestart.sqlite.prepare('SELECT COUNT(*) AS n FROM threads').get() as { n: number })
            .n,
        ).toBe(1);
      } finally {
        afterRestart.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
