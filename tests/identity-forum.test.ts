import { auditLogs, sessions, tokens, users } from '@mcp-community/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Fixture, fixture, PASSWORD } from './helpers.js';

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => f?.db.close());

describe('identity and authorization', () => {
  it('does not allow a second bootstrap administrator', async () => {
    await expect(
      f.core.identity.bootstrapAdmin({ username: 'other', name: 'Other', password: PASSWORD }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('hashes passwords and stores only session and access-token hashes', async () => {
    const session = await f.core.identity.login(
      { username: 'admin', password: PASSWORD },
      '127.0.0.1',
    );
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Reviewer',
      scopes: ['forum:read'],
      expiresInDays: 1,
    });
    const stored = JSON.stringify({
      users: f.db.orm.select().from(users).all(),
      sessions: f.db.orm.select().from(sessions).all(),
      tokens: f.db.orm.select().from(tokens).all(),
      audit: f.db.orm.select().from(auditLogs).all(),
    });
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(session.token);
    expect(stored).not.toContain(issued.token);
    expect(stored).toContain('scrypt$');
    expect(f.core.identity.session(session.token)?.principal?.actorId).toBe(f.admin.id);
  });
  it('rejects invalid credentials without disclosing which field is wrong', async () => {
    await expect(
      f.core.identity.login({ username: 'admin', password: 'incorrect-password' }, '127.0.0.1'),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    await expect(
      f.core.identity.login({ username: 'absent', password: 'incorrect-password' }, '127.0.0.1'),
    ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
  });
  it('rejects administrator operations from members and agents', async () => {
    await expect(
      f.core.identity.createHuman(f.memberContext, {
        username: 'bad',
        name: 'Bad',
        password: PASSWORD,
        role: 'admin',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Agent',
      scopes: ['forum:read'],
      expiresInDays: 1,
    });
    const agent = f.core.identity.authenticateToken(issued.token);
    expect(() =>
      f.core.identity.createAgent(agent, {
        name: 'Nested',
        scopes: ['forum:read'],
        expiresInDays: 1,
      }),
    ).toThrow('Human administrator required');
  });
  it('rejects unsupported token scopes and revoked tokens', () => {
    expect(() =>
      f.core.identity.createAgent(f.adminContext, {
        name: 'Agent',
        scopes: ['admin'],
        expiresInDays: 1,
      }),
    ).toThrow();
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Agent',
      scopes: ['forum:read'],
      expiresInDays: 1,
    });
    expect(f.core.identity.authenticateToken(issued.token).actorId).toBe(issued.actor.id);
    f.core.identity.revokeToken(f.adminContext, issued.tokenId);
    expect(() => f.core.identity.authenticateToken(issued.token)).toThrow('Invalid access token');
    expect(() => f.core.identity.authenticateToken('invalid')).toThrow('Invalid access token');
  });
});

describe('forum services', () => {
  it('creates a thread and first post, then a reply with trusted author identity', () => {
    const thread = f.core.forum.createThread(f.memberContext, {
      title: 'MCP improvements',
      body: 'First post',
    });
    const reply = f.core.forum.reply(f.adminContext, { threadId: thread.id, body: 'Reviewed' });
    const result = f.core.forum.getThread(f.memberContext, { id: thread.id });
    expect(result.thread.title).toBe('MCP improvements');
    expect(result.posts.map((p) => p.body)).toEqual(['First post', 'Reviewed']);
    expect(reply.actorId).toBe(f.admin.id);
    expect(result.posts[0]?.authorKind).toBe('human');
  });
  it('paginates and rejects malformed and extra fields', () => {
    for (let i = 0; i < 3; i++)
      f.core.forum.createThread(f.memberContext, { title: `Thread ${i}`, body: 'Text' });
    expect(f.core.forum.listThreads(f.memberContext, { page: 1, pageSize: 2 })).toMatchObject({
      hasNext: true,
      page: 1,
    });
    expect(f.core.forum.listThreads(f.memberContext, { page: 2, pageSize: 2 }).items).toHaveLength(
      1,
    );
    expect(() => f.core.forum.createThread(f.memberContext, { title: '', body: 'Text' })).toThrow();
    expect(() =>
      f.core.forum.createThread(f.memberContext, {
        title: 'Spoof',
        body: 'Text',
        actorId: f.admin.id,
      }),
    ).toThrow();
    expect(() => f.core.forum.listThreads(f.memberContext, { page: -1 })).toThrow();
  });
  it('rejects anonymous writes and scoped read-only agent writes', () => {
    expect(() => f.core.forum.createThread(null, { title: 'No', body: 'No' })).toThrow(
      'Authentication required',
    );
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Reader',
      scopes: ['forum:read'],
      expiresInDays: 1,
    });
    const agent = f.core.identity.authenticateToken(issued.token);
    expect(() => f.core.forum.createThread(agent, { title: 'No', body: 'No' })).toThrow(
      'Insufficient scope',
    );
  });
  it('hides moderated threads and replies from ordinary readers', () => {
    const thread = f.core.forum.createThread(f.memberContext, {
      title: 'Moderation',
      body: 'First',
    });
    const post = f.core.forum.reply(f.memberContext, { threadId: thread.id, body: 'Hide me' });
    expect(() =>
      f.core.forum.moderate(f.memberContext, { kind: 'post', id: post.id, hidden: true }),
    ).toThrow();
    f.core.forum.moderate(f.adminContext, { kind: 'post', id: post.id, hidden: true });
    expect(f.core.forum.getThread(f.memberContext, { id: thread.id }).posts).toHaveLength(1);
    f.core.forum.moderate(f.adminContext, { kind: 'thread', id: thread.id, hidden: true });
    expect(f.core.forum.listThreads(f.memberContext, {}).items).toHaveLength(0);
    expect(() => f.core.forum.getThread(f.memberContext, { id: thread.id })).toThrow('Not found');
    expect(
      f.db.orm
        .select()
        .from(auditLogs)
        .all()
        .filter((a) => a.action === 'forum.moderate'),
    ).toHaveLength(2);
  });
  it('limits repeated writes per actor', () => {
    for (let i = 0; i < 30; i++)
      f.core.forum.createThread(f.memberContext, { title: `Thread ${i}`, body: 'Text' });
    expect(() =>
      f.core.forum.createThread(f.memberContext, { title: 'Too many', body: 'Text' }),
    ).toThrow('Rate limit exceeded');
  });
});
