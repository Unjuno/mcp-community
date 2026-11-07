import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookie, csrf, type Fixture, fixture, login, ORIGIN, PASSWORD } from './helpers.js';
import { connect, listen } from './mcp-helpers.js';

const initial = {
  id: 'community-guide',
  title: 'Community guide',
  body: 'Original reviewed content',
  sources: ['https://example.org/guide'],
};
describe('reviewed knowledge', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });
  afterEach(() => f.db.close());
  it('creates a resource, lists it and retains source and revision provenance', () => {
    const made = f.core.knowledge.create(f.adminContext, initial);
    expect(made.currentRevision).toBe(1);
    expect(f.core.knowledge.list(f.memberContext).items[0]?.id).toBe(initial.id);
    expect(f.core.knowledge.get(f.memberContext, { id: initial.id }).sources).toEqual(
      initial.sources,
    );
    const history = f.core.knowledge.history(f.memberContext, { id: initial.id });
    expect(history.items[0]).toMatchObject({
      number: 1,
      authorId: f.admin.id,
      reviewerId: f.admin.id,
    });
  });
  it('accepts a member proposal but changes official content only after human approval', () => {
    f.core.knowledge.create(f.adminContext, initial);
    const proposal = f.core.knowledge.propose(f.memberContext, {
      ...initial,
      baseRevision: 1,
      body: 'Reviewed improvement',
      note: 'Verified against source',
    });
    expect(f.core.knowledge.get(f.memberContext, { id: initial.id }).body).toBe(initial.body);
    expect(f.core.knowledge.listProposals(f.memberContext, {}).items[0]?.status).toBe('pending');
    f.core.knowledge.approve(f.adminContext, { id: proposal.id });
    expect(f.core.knowledge.get(f.memberContext, { id: initial.id })).toMatchObject({
      body: 'Reviewed improvement',
      currentRevision: 2,
    });
    expect(f.core.knowledge.history(f.memberContext, { id: initial.id }).items[0]).toMatchObject({
      authorId: f.member.id,
      reviewerId: f.admin.id,
    });
    expect(() => f.core.knowledge.approve(f.adminContext, { id: proposal.id })).toThrow();
  });
  it('rejects stale approvals without publishing or changing their status', () => {
    f.core.knowledge.create(f.adminContext, initial);
    const a = f.core.knowledge.propose(f.memberContext, { ...initial, baseRevision: 1, body: 'A' });
    const b = f.core.knowledge.propose(f.memberContext, { ...initial, baseRevision: 1, body: 'B' });
    f.core.knowledge.approve(f.adminContext, { id: a.id });
    expect(() => f.core.knowledge.approve(f.adminContext, { id: b.id })).toThrowError(
      expect.objectContaining({ status: 409, code: 'REVISION_CONFLICT' }),
    );
    expect(f.core.knowledge.getProposal(f.memberContext, b.id).proposal.status).toBe('pending');
    expect(f.core.knowledge.get(f.memberContext, { id: initial.id }).body).toBe('A');
    expect(f.core.knowledge.history(f.memberContext, { id: initial.id }).items).toHaveLength(2);
  });
  it('rejects member/agent approval, self-approval, invalid sources and duplicate resources', () => {
    f.core.knowledge.create(f.adminContext, initial);
    expect(() => f.core.knowledge.create(f.adminContext, initial)).toThrowError(
      expect.objectContaining({ status: 409 }),
    );
    expect(() =>
      f.core.knowledge.create(f.memberContext, { ...initial, id: 'another' }),
    ).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() =>
      f.core.knowledge.propose(f.memberContext, {
        ...initial,
        baseRevision: 1,
        sources: ['javascript:alert(1)'],
      }),
    ).toThrowError(expect.objectContaining({ status: 400 }));
    const p = f.core.knowledge.propose(f.memberContext, { ...initial, baseRevision: 1 });
    expect(() => f.core.knowledge.approve(f.memberContext, { id: p.id })).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
    const own = f.core.knowledge.propose(f.adminContext, { ...initial, baseRevision: 1 });
    expect(() => f.core.knowledge.approve(f.adminContext, { id: own.id })).toThrowError(
      expect.objectContaining({ code: 'SELF_APPROVAL' }),
    );
    const agent = f.core.identity.createAgent(f.adminContext, {
      name: 'Proposer',
      scopes: ['knowledge:propose'],
    });
    expect(() =>
      f.core.knowledge.approve(f.core.identity.authenticateToken(agent.token), { id: p.id }),
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });
  it('rejects proposals with a reason and restores by appending rather than rewriting', () => {
    f.core.knowledge.create(f.adminContext, initial);
    const rejected = f.core.knowledge.propose(f.memberContext, {
      ...initial,
      baseRevision: 1,
      body: 'Unverified',
    });
    f.core.knowledge.reject(f.adminContext, { id: rejected.id, reason: 'Source is insufficient' });
    expect(f.core.knowledge.getProposal(f.memberContext, rejected.id).proposal.status).toBe(
      'rejected',
    );
    const approved = f.core.knowledge.propose(f.memberContext, {
      ...initial,
      baseRevision: 1,
      body: 'New content',
    });
    f.core.knowledge.approve(f.adminContext, { id: approved.id });
    f.core.knowledge.restore(f.adminContext, {
      id: initial.id,
      revision: 1,
      expectedRevision: 2,
      reason: 'Rollback after verification',
    });
    expect(f.core.knowledge.get(f.memberContext, { id: initial.id })).toMatchObject({
      currentRevision: 3,
      body: initial.body,
    });
    const history = f.core.knowledge.history(f.memberContext, { id: initial.id });
    expect(history.items.map((r) => r.number)).toEqual([3, 2, 1]);
    expect(history.items[0]?.restoredFrom).toBe(1);
    expect(() =>
      f.db.sqlite
        .prepare('UPDATE knowledge_revisions SET body = ? WHERE resource_id = ?')
        .run('tamper', initial.id),
    ).toThrow();
    expect(() =>
      f.core.knowledge.restore(f.adminContext, {
        id: initial.id,
        revision: 1,
        expectedRevision: 2,
        reason: 'Stale',
      }),
    ).toThrowError(expect.objectContaining({ status: 409 }));
  });
  it('renders escaped diffs and requires CSRF on browser approval', async () => {
    f.core.knowledge.create(f.adminContext, initial);
    const p = f.core.knowledge.propose(f.memberContext, {
      ...initial,
      baseRevision: 1,
      body: '<script>alert(1)</script>',
    });
    const session = await login(f.app);
    const page = await f.app.request(`${ORIGIN}/proposals/${p.id}`, {
      headers: { cookie: session.cookie },
    });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('diff-add');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const denied = await f.app.request(`${ORIGIN}/proposals/${p.id}/approve`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: session.cookie },
      body: new URLSearchParams({}),
    });
    expect(denied.status).toBe(403);
    const accepted = await f.app.request(`${ORIGIN}/proposals/${p.id}/approve`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: session.cookie },
      body: new URLSearchParams({ _csrf: session.csrf }),
    });
    expect(accepted.status).toBe(303);
  });
});

describe('MCP proposal to browser review to MCP read', () => {
  it('publishes an agent proposal only after human approval and exposes all eight tools', async () => {
    const f = await fixture();
    const http = await listen(f);
    let client: Client | undefined;
    try {
      f.core.knowledge.create(f.adminContext, initial);
      const agent = f.core.identity.createAgent(f.adminContext, {
        name: 'Research agent',
        scopes: ['knowledge:read', 'knowledge:propose', 'proposals:read'],
      });
      client = await connect(http.origin, agent.token);
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'knowledge_list',
          'knowledge_get',
          'knowledge_propose_update',
          'proposals_list',
        ]),
      );
      const proposed = await client.callTool({
        name: 'knowledge_propose_update',
        arguments: { ...initial, baseRevision: 1, body: 'Human-reviewed agent contribution' },
      });
      expect(proposed.isError).not.toBe(true);
      const id = (proposed.structuredContent as { id: string }).id;
      const first = await fetch(`${http.origin}/login`);
      const guest = cookie(first);
      const firstCsrf = csrf(await first.text());
      const authenticated = await fetch(`${http.origin}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { origin: http.origin, cookie: guest },
        body: new URLSearchParams({ _csrf: firstCsrf, username: 'admin', password: PASSWORD }),
      });
      const session = cookie(authenticated);
      const form = await fetch(`${http.origin}/proposals/${id}`, { headers: { cookie: session } });
      const approve = await fetch(`${http.origin}/proposals/${id}/approve`, {
        method: 'POST',
        redirect: 'manual',
        headers: { origin: http.origin, cookie: session },
        body: new URLSearchParams({ _csrf: csrf(await form.text()) }),
      });
      expect(approve.status).toBe(303);
      const result = await client.callTool({
        name: 'knowledge_get',
        arguments: { id: initial.id },
      });
      expect(result.structuredContent).toMatchObject({
        currentRevision: 2,
        body: 'Human-reviewed agent contribution',
      });
      expect(
        JSON.stringify(await client.readResource({ uri: `community://knowledge/${initial.id}` })),
      ).toContain('Human-reviewed agent contribution');
    } finally {
      await client?.close();
      await http.close();
      f.db.close();
    }
  });
});
