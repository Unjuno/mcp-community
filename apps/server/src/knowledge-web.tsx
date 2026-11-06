import type { Community } from '@mcp-community/core';
import { diffLines } from 'diff';
import type { Context, Hono } from 'hono';
import type { WebEnvironment } from './app.js';
import { Csrf, Layout, Pager, Time } from './views.js';

function ContentFields(props: { title?: string; body?: string; sources?: string[] }) {
  return (
    <>
      <label for="title">Title</label>
      <input id="title" name="title" value={props.title ?? ''} maxlength={160} required />
      <label for="body">Content (plain text)</label>
      <textarea id="body" name="body" rows={10} maxlength={50000} required>
        {props.body ?? ''}
      </textarea>
      <label for="sources">Sources (one HTTP(S) URL per line; maximum 20)</label>
      <textarea id="sources" name="sources" rows={3} maxlength={41000}>
        {(props.sources ?? []).join('\n')}
      </textarea>
    </>
  );
}
function fields(form: Record<string, string>) {
  return {
    title: form.title,
    body: form.body,
    sources: (form.sources ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
export function registerKnowledgeRoutes(app: Hono<WebEnvironment>, core: Community) {
  const frame = (c: Context<WebEnvironment>) => ({
    actor: core.identity.actor(c.get('principal')),
    csrf: c.get('csrf'),
  });
  app.get('/knowledge', (c) => {
    const data = core.knowledge.list(c.get('principal'), {
      page: Number(c.req.query('page') ?? 1),
    });
    const common = frame(c);
    return c.html(
      <Layout title="Reviewed knowledge" {...common}>
        <section class="panel">
          <p>
            Authoritative resources are separate from discussion. Propose changes for human review.
          </p>
          {data.items.length === 0 && <p>No resources yet.</p>}
          {data.items.map((r) => (
            <article class="thread" key={r.id}>
              <a href={`/knowledge/${r.id}`}>{r.title}</a>
              <span class="meta">
                Revision {r.currentRevision} · <Time value={r.updatedAt} />
              </span>
            </article>
          ))}
          <Pager page={data.page} hasNext={data.hasNext} path="/knowledge" />
        </section>
        {common.actor.role === 'admin' && (
          <section class="panel">
            <h2>Create an initial resource</h2>
            <form action="/knowledge" method="post">
              <Csrf value={common.csrf} />
              <label for="id">Stable identifier</label>
              <input id="id" name="id" pattern="[a-z0-9][a-z0-9-]{0,79}" maxlength={80} required />
              <ContentFields />
              <button type="submit">Create resource</button>
            </form>
          </section>
        )}
      </Layout>,
    );
  });
  app.post('/knowledge', (c) => {
    const form = c.get('form');
    const resource = core.knowledge.create(c.get('principal'), { id: form.id, ...fields(form) });
    return c.redirect(`/knowledge/${resource.id}`, 303);
  });
  app.get('/knowledge/:id/history', (c) => {
    const id = c.req.param('id');
    const data = core.knowledge.history(c.get('principal'), {
      id,
      page: Number(c.req.query('page') ?? 1),
    });
    const current = core.knowledge.get(c.get('principal'), { id });
    const common = frame(c);
    return c.html(
      <Layout title={`History: ${current.title}`} {...common}>
        <section class="panel">
          <a href={`/knowledge/${id}`}>Current resource</a>
          <p>Restoring a version appends a new revision; existing history is immutable.</p>
          {data.items.map((r) => (
            <article class="thread" key={r.number}>
              <h2>Revision {r.number}</h2>
              <p class="meta">
                <Time value={r.createdAt} /> · author {r.authorId} · reviewer {r.reviewerId}
              </p>
              <p>{r.reason}</p>
              <details>
                <summary>Content and sources</summary>
                <h3>{r.title}</h3>
                <pre class="content">{r.body}</pre>
                <pre class="content">{r.sources.join('\n')}</pre>
              </details>
              {common.actor.role === 'admin' && r.number !== current.currentRevision && (
                <form action={`/knowledge/${id}/restore`} method="post">
                  <Csrf value={common.csrf} />
                  <input type="hidden" name="revision" value={r.number} />
                  <input type="hidden" name="expectedRevision" value={current.currentRevision} />
                  <label>
                    Reason for restoration
                    <input name="reason" required maxlength={2000} />
                  </label>
                  <button type="submit">Restore as a new revision</button>
                </form>
              )}
            </article>
          ))}
          <Pager page={data.page} hasNext={data.hasNext} path={`/knowledge/${id}/history`} />
        </section>
      </Layout>,
    );
  });
  app.post('/knowledge/:id/restore', (c) => {
    const form = c.get('form');
    const id = c.req.param('id');
    core.knowledge.restore(c.get('principal'), {
      id,
      revision: Number(form.revision),
      expectedRevision: Number(form.expectedRevision),
      reason: form.reason,
    });
    return c.redirect(`/knowledge/${id}/history`, 303);
  });
  app.get('/knowledge/:id', (c) => {
    const resource = core.knowledge.get(c.get('principal'), { id: c.req.param('id') });
    const common = frame(c);
    return c.html(
      <Layout title={resource.title} {...common}>
        <section class="panel">
          <p class="meta">
            Revision {resource.currentRevision} · <Time value={resource.updatedAt} /> ·{' '}
            <a href={`/knowledge/${resource.id}/history`}>Revision history</a>
          </p>
          <pre class="content">{resource.body}</pre>
          <h2>Sources</h2>
          {resource.sources.length === 0 && <p>No sources supplied.</p>}
          <ul>
            {resource.sources.map((source) => (
              <li key={source}>
                <a href={source} rel="nofollow noreferrer">
                  {source}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section class="panel">
          <h2>Propose an improvement</h2>
          <p>
            This does not change the published resource until another human administrator approves
            it.
          </p>
          <form action={`/knowledge/${resource.id}/propose`} method="post">
            <Csrf value={common.csrf} />
            <input type="hidden" name="baseRevision" value={resource.currentRevision} />
            <ContentFields {...resource} />
            <label for="note">Reason and evidence</label>
            <textarea id="note" name="note" maxlength={2000} rows={3} />
            <button type="submit">Submit proposal</button>
          </form>
        </section>
      </Layout>,
    );
  });
  app.post('/knowledge/:id/propose', (c) => {
    const form = c.get('form');
    const proposal = core.knowledge.propose(c.get('principal'), {
      id: c.req.param('id'),
      ...fields(form),
      baseRevision: Number(form.baseRevision),
      note: form.note ?? '',
    });
    return c.redirect(`/proposals/${proposal.id}`, 303);
  });
  app.get('/proposals', (c) => {
    const result = core.knowledge.listProposals(c.get('principal'), {
      page: Number(c.req.query('page') ?? 1),
    });
    return c.html(
      <Layout title="Change proposals" {...frame(c)}>
        <section class="panel">
          {result.items.length === 0 && <p>No proposals yet.</p>}
          {result.items.map((p) => (
            <article class="thread" key={p.id}>
              <a href={`/proposals/${p.id}`}>{p.title}</a>
              <p class="meta">
                {p.status} · {p.resourceId} · base revision {p.baseRevision} ·{' '}
                <Time value={p.createdAt} />
              </p>
            </article>
          ))}
          <Pager page={result.page} hasNext={result.hasNext} path="/proposals" />
        </section>
      </Layout>,
    );
  });
  app.get('/proposals/:id', (c) => {
    const {
      proposal: p,
      base,
      currentRevision,
    } = core.knowledge.getProposal(c.get('principal'), c.req.param('id'));
    const common = frame(c);
    const changes = diffLines(base.body, p.body, { maxEditLength: 2000, timeout: 50 }) ?? [
      { value: base.body, removed: true, added: false },
      { value: p.body, removed: false, added: true },
    ];
    return c.html(
      <Layout title={`Proposal: ${p.title}`} {...common}>
        <section class="panel">
          <p>
            Status: <strong>{p.status}</strong> · base {p.baseRevision} · current {currentRevision}
          </p>
          <p class="meta">
            Author: {p.authorId} · <Time value={p.createdAt} />
          </p>
          <p>{p.note}</p>
          <h2>Title</h2>
          <p>
            <del>{base.title}</del> → <ins>{p.title}</ins>
          </p>
          <h2>Content diff</h2>
          <pre class="content">
            {changes.map((part, i) => (
              <span
                key={`${i}-${part.added}`}
                class={part.added ? 'diff-add' : part.removed ? 'diff-remove' : ''}
              >
                {part.added ? '+ ' : part.removed ? '- ' : '  '}
                {part.value}
              </span>
            ))}
          </pre>
          <h2>Sources before</h2>
          <pre class="content">{base.sources.join('\n') || '(none)'}</pre>
          <h2>Sources proposed</h2>
          <pre class="content">{p.sources.join('\n') || '(none)'}</pre>
          {p.status !== 'pending' && (
            <p>
              Reviewed by {p.reviewerId}: {p.decisionNote}
            </p>
          )}
          {p.status === 'pending' && currentRevision !== p.baseRevision && (
            <p role="alert">
              This proposal is stale. Submit a new proposal based on the current resource.
            </p>
          )}
          {p.status === 'pending' && common.actor.role === 'admin' && (
            <div class="review-actions">
              {common.actor.id !== p.authorId && currentRevision === p.baseRevision && (
                <form action={`/proposals/${p.id}/approve`} method="post">
                  <Csrf value={common.csrf} />
                  <label>
                    Review note
                    <input name="reason" maxlength={2000} />
                  </label>
                  <button type="submit">Approve and publish</button>
                </form>
              )}
              <form action={`/proposals/${p.id}/reject`} method="post">
                <Csrf value={common.csrf} />
                <label>
                  Reason for rejection
                  <input name="reason" required maxlength={2000} />
                </label>
                <button class="danger" type="submit">
                  Reject
                </button>
              </form>
            </div>
          )}
        </section>
      </Layout>,
    );
  });
  app.post('/proposals/:id/approve', (c) => {
    core.knowledge.approve(c.get('principal'), {
      id: c.req.param('id'),
      reason: c.get('form').reason ?? '',
    });
    return c.redirect(`/proposals/${c.req.param('id')}`, 303);
  });
  app.post('/proposals/:id/reject', (c) => {
    core.knowledge.reject(c.get('principal'), {
      id: c.req.param('id'),
      reason: c.get('form').reason,
    });
    return c.redirect(`/proposals/${c.req.param('id')}`, 303);
  });
}
