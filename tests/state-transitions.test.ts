import { auditLogs, outboxEvents } from '@mcp-community/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Fixture, fixture, login, ORIGIN, PASSWORD } from './helpers.js';
import { connect, listen } from './mcp-helpers.js';

const knowledgeInput = {
  id: 'community-policy',
  title: 'Community policy',
  body: 'Original statement',
  sources: [] as string[],
};

describe('explicit lifecycle invariants across application services', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });
  afterEach(() => f.db.close());

  it('projects an outdated pending proposal as conflicted without corrupting immutable history', () => {
    f.core.knowledge.create(f.adminContext, knowledgeInput);
    const first = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Accepted',
    });
    const second = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Outdated',
    });
    expect(f.core.knowledge.getProposal(f.adminContext, second.id).state).toBe('pending');
    f.core.knowledge.approve(f.adminContext, { id: first.id });
    const conflicted = f.core.knowledge.getProposal(f.adminContext, second.id);
    expect(conflicted.proposal.status).toBe('pending'); // Persisted decisions are immutable.
    expect(conflicted.state).toBe('conflicted'); // Current-state projection is explicit.
    expect(
      f.core.knowledge.listProposals(f.adminContext, { status: 'pending' }).items,
    ).toContainEqual(expect.objectContaining({ id: second.id, state: 'conflicted' }));
    expect(() => f.core.knowledge.approve(f.adminContext, { id: second.id })).toThrowError(
      expect.objectContaining({ code: 'REVISION_CONFLICT', status: 409 }),
    );
    f.core.knowledge.reject(f.adminContext, {
      id: second.id,
      reason: 'Superseded by published revision',
    });
    expect(f.core.knowledge.getProposal(f.adminContext, second.id).state).toBe('rejected');
    expect(f.core.knowledge.history(f.adminContext, { id: knowledgeInput.id }).items).toHaveLength(
      2,
    );
  });

  it('rejects submissions based on an already obsolete knowledge revision', () => {
    f.core.knowledge.create(f.adminContext, knowledgeInput);
    const updated = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Updated',
    });
    f.core.knowledge.approve(f.adminContext, { id: updated.id });
    expect(() =>
      f.core.knowledge.propose(f.memberContext, {
        ...knowledgeInput,
        baseRevision: 1,
        body: 'Already stale on submission',
      }),
    ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT', status: 409 }));
  });

  it('revokes a disabled agent token permanently, including after reactivation', () => {
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Automation',
      scopes: ['forum:read'],
    });
    expect(f.core.identity.authenticateToken(issued.token).actorId).toBe(issued.actor.id);
    f.core.identity.setDisabled(f.adminContext, { actorId: issued.actor.id, disabled: true });
    expect(() => f.core.identity.authenticateToken(issued.token)).toThrow();
    f.core.identity.setDisabled(f.adminContext, { actorId: issued.actor.id, disabled: false });
    expect(() => f.core.identity.authenticateToken(issued.token)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('revokes child agent tokens on human owner disablement without resurrecting them', async () => {
    const second = await f.core.identity.createHuman(f.adminContext, {
      username: 'reviewer',
      name: 'Reviewer',
      password: PASSWORD,
      role: 'admin',
    });
    const secondContext = { actorId: second.id, channel: 'cli' as const, scopes: [] };
    const owned = f.core.identity.createAgent(f.adminContext, {
      name: 'Owned bot',
      scopes: ['forum:read'],
    });
    const session = await f.core.identity.login({ username: 'admin', password: PASSWORD }, 'test');
    f.core.identity.setDisabled(secondContext, { actorId: f.admin.id, disabled: true });
    expect(f.core.identity.session(session.token)).toBeNull();
    f.core.identity.setDisabled(secondContext, { actorId: f.admin.id, disabled: false });
    expect(() => f.core.identity.authenticateToken(owned.token)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('revokes owned agent credentials on administrator password reset', async () => {
    const reviewer = await f.core.identity.createHuman(f.adminContext, {
      username: 'reviewer',
      name: 'Reviewer',
      password: PASSWORD,
      role: 'admin',
    });
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Bot',
      scopes: ['forum:read'],
    });
    await f.core.identity.resetPassword(
      { actorId: reviewer.id, channel: 'cli', scopes: [] },
      { actorId: f.admin.id, password: 'New-password-strong-enough' },
    );
    expect(() => f.core.identity.authenticateToken(issued.token)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TOKEN' }),
    );
  });

  it('does not generate duplicate revocation audit entries on repeated requests', () => {
    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Bot',
      scopes: ['forum:read'],
    });
    f.core.identity.revokeToken(f.adminContext, issued.tokenId);
    f.core.identity.revokeToken(f.adminContext, issued.tokenId);
    const logs = f.db.orm
      .select()
      .from(auditLogs)
      .all()
      .filter((log) => log.action === 'identity.revoke_token' && log.target === issued.tokenId);
    expect(logs).toHaveLength(1);
  });

  it('protects opening posts from becoming invisible while their thread stays visible', () => {
    const thread = f.core.forum.createThread(f.memberContext, {
      title: 'Discussion',
      body: 'Opening statement',
    });
    const opening = f.core.forum.getThread(f.memberContext, { id: thread.id }).posts[0];
    if (!opening) throw new Error('Expected thread opening post');
    const reply = f.core.forum.reply(f.memberContext, { threadId: thread.id, body: 'Answer' });
    expect(() =>
      f.core.forum.moderate(f.adminContext, {
        kind: 'post',
        id: opening.id,
        hidden: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'OPENING_POST', status: 409 }));
    expect(f.core.forum.getThread(f.memberContext, { id: thread.id }).posts).toHaveLength(2);
    const queue = f.core.forum.moderationQueue(f.adminContext);
    expect(queue.posts.find((post) => post.id === opening.id)?.isOpeningPost).toBe(true);
    expect(queue.posts.find((post) => post.id === reply.id)?.isOpeningPost).toBe(false);
  });

  it('treats repeated moderation of the same state as an idempotent no-op', () => {
    const thread = f.core.forum.createThread(f.memberContext, {
      title: 'Moderation',
      body: 'Original',
    });
    const reply = f.core.forum.reply(f.memberContext, { threadId: thread.id, body: 'Reply' });
    f.core.forum.moderate(f.adminContext, { kind: 'post', id: reply.id, hidden: true });
    f.core.forum.moderate(f.adminContext, { kind: 'post', id: reply.id, hidden: true });
    const logs = f.db.orm
      .select()
      .from(auditLogs)
      .all()
      .filter((log) => log.action === 'forum.moderate' && log.target === reply.id);
    const events = f.db.orm
      .select()
      .from(outboxEvents)
      .all()
      .filter((event) => event.kind === 'forum.moderated' && event.entityId === reply.id);
    expect(logs).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('exposes review state consistently in the Web UI and actual MCP tool results', async () => {
    f.core.knowledge.create(f.adminContext, knowledgeInput);
    const accepted = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'First accepted change',
    });
    const outdated = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Stale content',
    });
    f.core.knowledge.approve(f.adminContext, { id: accepted.id });
    const s = await login(f.app);
    const listing = await f.app.request(`${ORIGIN}/proposals`, { headers: { cookie: s.cookie } });
    expect(await listing.text()).toContain('Conflicted');
    const detail = await f.app.request(`${ORIGIN}/proposals/${outdated.id}`, {
      headers: { cookie: s.cookie },
    });
    const html = await detail.text();
    expect(html).toContain('Conflicted');
    expect(html).not.toContain('Approve and publish');
    expect(html).toContain('Reject');

    const issued = f.core.identity.createAgent(f.adminContext, {
      name: 'Reviewer bot',
      scopes: ['proposals:read'],
    });
    const http = await listen(f);
    const client = await connect(http.origin, issued.token);
    try {
      const result = await client.callTool({ name: 'proposals_list', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ id: outdated.id, status: 'pending', state: 'conflicted' }),
          ]),
        }),
      );
    } finally {
      await client.close();
      await http.close();
    }
  });

  it('renders a non-actionable opening post and preserves an obvious whole-thread control', async () => {
    const thread = f.core.forum.createThread(f.memberContext, {
      title: 'Opening post example',
      body: 'Root post contents',
    });
    f.core.forum.reply(f.memberContext, { threadId: thread.id, body: 'Another reply' });
    const s = await login(f.app);
    const response = await f.app.request(`${ORIGIN}/admin`, {
      headers: { cookie: s.cookie },
    });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Opening post — moderate the entire thread above.');
    expect(html).toContain('Hide thread');
    expect(html).toContain('Hide post');
  });

  it('enforces terminal proposal decisions at the SQLite boundary', () => {
    f.core.knowledge.create(f.adminContext, knowledgeInput);
    const proposal = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Reviewed update',
    });
    f.core.knowledge.approve(f.adminContext, { id: proposal.id });
    expect(() =>
      f.db.sqlite.prepare("UPDATE proposals SET status = 'pending' WHERE id = ?").run(proposal.id),
    ).toThrow(/Resolved proposals are immutable/);
    expect(f.core.knowledge.getProposal(f.adminContext, proposal.id).state).toBe('approved');
  });

  it('preserves the contributor note when approval form leaves its optional review note blank', () => {
    f.core.knowledge.create(f.adminContext, knowledgeInput);
    const proposal = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Evidence-backed change',
      note: 'Verified against the public source',
    });
    f.core.knowledge.approve(f.adminContext, { id: proposal.id, reason: '' });
    expect(
      f.core.knowledge.history(f.adminContext, { id: knowledgeInput.id }).items[0]?.reason,
    ).toBe('Verified against the public source');
  });

  it('emits both the proposal resolution and the knowledge publication within approval', () => {
    f.core.knowledge.create(f.adminContext, knowledgeInput);
    const proposal = f.core.knowledge.propose(f.memberContext, {
      ...knowledgeInput,
      baseRevision: 1,
      body: 'Approved knowledge',
    });
    f.core.knowledge.approve(f.adminContext, { id: proposal.id });
    const events = f.db.orm.select().from(outboxEvents).all();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'proposal.resolved', entityId: proposal.id }),
        expect.objectContaining({ kind: 'knowledge.updated', entityId: knowledgeInput.id }),
      ]),
    );
  });
});
