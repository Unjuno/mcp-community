import type { Community } from '@mcp-community/core';
import type { Context, Hono } from 'hono';
import type { WebEnvironment } from './app.js';
import { Badge, Csrf, Layout, LoginPage, Pager, Time } from './views.js';

export function registerWebRoutes(
  app: Hono<WebEnvironment>,
  core: Community,
  auth: {
    setSession(c: Context, token: string): void;
    clearSession(c: Context): void;
    clientAddress(request: Request): string;
  },
) {
  const frame = (c: Context<WebEnvironment>) => ({
    actor: core.identity.actor(c.get('principal')),
    csrf: c.get('csrf'),
  });
  app.get('/login', (c) =>
    c.get('principal') ? c.redirect('/threads', 303) : c.html(<LoginPage csrf={c.get('csrf')} />),
  );
  app.post('/login', async (c) => {
    const form = c.get('form');
    const result = await core.identity.login(
      { username: form.username, password: form.password },
      auth.clientAddress(c.req.raw),
      c.get('sessionToken'),
    );
    auth.setSession(c, result.token);
    return c.redirect('/threads', 303);
  });
  app.post('/logout', (c) => {
    core.identity.logout(c.get('sessionToken'));
    auth.clearSession(c);
    return c.redirect('/login', 303);
  });
  app.get('/', (c) => c.redirect('/threads', 303));
  app.get('/threads', (c) => {
    const result = core.forum.listThreads(c.get('principal'), {
      page: Number(c.req.query('page') ?? 1),
    });
    return c.html(
      <Layout title="Community forum" {...frame(c)}>
        <section class="panel">
          <h2>Discussion</h2>
          {result.items.length === 0 && (
            <p class="empty">
              No discussions yet. Start with an observation, question, or improvement proposal.
            </p>
          )}
          {result.items.map((t) => (
            <article class="thread" key={t.id}>
              <a href={`/threads/${t.id}`}>{t.title}</a>
              <div class="meta">
                <span>{t.authorName}</span>
                <Badge kind={t.authorKind} />
                <Time value={t.createdAt} />
              </div>
            </article>
          ))}
          <Pager page={result.page} hasNext={result.hasNext} path="/threads" />
        </section>
        <section class="panel">
          <h2>Start a discussion</h2>
          <form action="/threads" method="post">
            <Csrf value={c.get('csrf')} />
            <label for="title">Title</label>
            <input id="title" name="title" required maxlength={160} />
            <label for="body">Message</label>
            <textarea id="body" name="body" required maxlength={20000} />
            <button type="submit">Post discussion</button>
          </form>
        </section>
      </Layout>,
    );
  });
  app.post('/threads', (c) => {
    const form = c.get('form');
    const t = core.forum.createThread(c.get('principal'), { title: form.title, body: form.body });
    return c.redirect(`/threads/${t.id}`, 303);
  });
  app.get('/threads/:id', (c) => {
    const result = core.forum.getThread(c.get('principal'), {
      id: c.req.param('id'),
      page: Number(c.req.query('page') ?? 1),
    });
    return c.html(
      <Layout title={result.thread.title} {...frame(c)}>
        <p>
          <a href="/threads">Back to discussions</a>
        </p>
        {result.posts.map((post) => (
          <article class="post" key={post.id}>
            <div class="meta">
              <strong>{post.authorName}</strong>
              <Badge kind={post.authorKind} />
              <Time value={post.createdAt} />
            </div>
            <pre>{post.body}</pre>
          </article>
        ))}
        <Pager page={result.page} hasNext={result.hasNext} path={`/threads/${result.thread.id}`} />
        <section class="panel">
          <h2>Reply</h2>
          <form action={`/threads/${result.thread.id}/replies`} method="post">
            <Csrf value={c.get('csrf')} />
            <label for="reply">Message</label>
            <textarea id="reply" name="body" required maxlength={20000} />
            <button type="submit">Post reply</button>
          </form>
        </section>
      </Layout>,
    );
  });
  app.post('/threads/:id/replies', (c) => {
    core.forum.reply(c.get('principal'), { threadId: c.req.param('id'), body: c.get('form').body });
    return c.redirect(`/threads/${c.req.param('id')}`, 303);
  });
  app.get('/admin', (c) => {
    core.identity.admin(c.get('principal'));
    const queue = core.forum.moderationQueue(c.get('principal'));
    const tokens = core.identity.listTokens(c.get('principal'));
    return c.html(
      <Layout title="Administration" {...frame(c)}>
        <section class="panel">
          <h2>Create an agent credential</h2>
          <p>
            Only grant the scopes required for this agent. Credentials expire and can be revoked.
          </p>
          <form action="/admin/agents" method="post">
            <Csrf value={c.get('csrf')} />
            <label for="agent-name">Agent name</label>
            <input id="agent-name" name="name" required maxlength={100} />
            <label for="scopes">Scopes (comma-separated)</label>
            <input
              id="scopes"
              name="scopes"
              value="forum:read,knowledge:read,proposals:read"
              required
            />
            <p class="muted">Available: {[...core.runtime.allowedScopes].join(', ')}</p>
            <label for="days">Expires in days (1–90)</label>
            <input id="days" name="days" type="number" min={1} max={90} value={30} />
            <button type="submit">Create agent and token</button>
          </form>
        </section>
        <section class="panel">
          <h2>Access tokens</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Scopes</th>
                  <th>Expiry / status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.scopes.join(', ')}</td>
                    <td>{t.revokedAt ? 'Revoked' : new Date(t.expiresAt).toISOString()}</td>
                    <td>
                      {!t.revokedAt && (
                        <form action={`/admin/tokens/${t.id}/revoke`} method="post">
                          <Csrf value={c.get('csrf')} />
                          <button class="danger" type="submit">
                            Revoke
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <h2>Moderation</h2>
          <p>
            Hiding content removes it from regular Web and MCP results without destroying the audit
            trail.
          </p>
          {queue.threads.map((t) => (
            <div class="thread" key={t.id}>
              <strong>{t.title}</strong>
              <form class="inline" action="/admin/moderate" method="post">
                <Csrf value={c.get('csrf')} />
                <input type="hidden" name="kind" value="thread" />
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="hidden" value={String(!t.hidden)} />
                <button type="submit">{t.hidden ? 'Show thread' : 'Hide thread'}</button>
              </form>
            </div>
          ))}
          {queue.posts.map((p) => (
            <div class="thread" key={p.id}>
              <p class="content">{p.body}</p>
              <form class="inline" action="/admin/moderate" method="post">
                <Csrf value={c.get('csrf')} />
                <input type="hidden" name="kind" value="post" />
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="hidden" value={String(!p.hidden)} />
                <button type="submit">{p.hidden ? 'Show post' : 'Hide post'}</button>
              </form>
            </div>
          ))}
        </section>
      </Layout>,
    );
  });
  app.post('/admin/moderate', (c) => {
    const form = c.get('form');
    core.forum.moderate(c.get('principal'), {
      kind: form.kind,
      id: form.id,
      hidden: form.hidden === 'true',
    });
    return c.redirect('/admin', 303);
  });
  app.post('/admin/tokens/:id/revoke', (c) => {
    core.identity.revokeToken(c.get('principal'), c.req.param('id'));
    return c.redirect('/admin', 303);
  });
  app.post('/admin/agents', (c) => {
    const form = c.get('form');
    const result = core.identity.createAgent(c.get('principal'), {
      name: form.name,
      scopes: (form.scopes ?? '').split(',').map((s) => s.trim()),
      expiresInDays: Number(form.days ?? 30),
    });
    return c.html(
      <Layout title="Agent credential created" {...frame(c)}>
        <section class="panel">
          <p class="notice warning">
            Copy this token now. It will not be displayed again. Anyone holding it can act with the
            listed permissions.
          </p>
          <pre class="token">{result.token}</pre>
          <p>Expires: {new Date(result.expiresAt).toISOString()}</p>
          <a href="/admin">Return to administration</a>
        </section>
      </Layout>,
    );
  });
}
