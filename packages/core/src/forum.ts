import { randomUUID } from 'node:crypto';
import { actors, posts, threads } from '@mcp-community/database';
import { and, asc, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, notFound, parse } from './errors.js';
import type { Runtime } from './runtime.js';
import type { Principal } from './types.js';

export const paginationSchema = z.strictObject({
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export const createThreadSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20000),
});
export const replySchema = z.strictObject({
  threadId: z.uuid(),
  body: z.string().trim().min(1).max(20000),
});
export const getThreadSchema = paginationSchema.extend({ id: z.uuid() });
const threadFields = {
  id: threads.id,
  title: threads.title,
  actorId: threads.actorId,
  authorName: actors.name,
  authorKind: actors.kind,
  createdAt: threads.createdAt,
  bumpedAt: threads.bumpedAt,
};
const postFields = {
  id: posts.id,
  threadId: posts.threadId,
  actorId: posts.actorId,
  authorName: actors.name,
  authorKind: actors.kind,
  body: posts.body,
  createdAt: posts.createdAt,
};

export class Forum {
  constructor(private readonly rt: Runtime) {}
  listThreads(principal: Principal | null, input: unknown = {}) {
    this.rt.require(principal, 'forum:read');
    const page = parse(paginationSchema, input);
    const rows = this.rt.db.orm
      .select(threadFields)
      .from(threads)
      .innerJoin(actors, eq(actors.id, threads.actorId))
      .where(eq(threads.hidden, false))
      .orderBy(desc(threads.bumpedAt), desc(threads.id))
      .limit(page.pageSize + 1)
      .offset((page.page - 1) * page.pageSize)
      .all();
    return { items: rows.slice(0, page.pageSize), ...page, hasNext: rows.length > page.pageSize };
  }
  getThread(principal: Principal | null, input: unknown) {
    this.rt.require(principal, 'forum:read');
    const data = parse(getThreadSchema, input);
    const thread = this.rt.db.orm
      .select(threadFields)
      .from(threads)
      .innerJoin(actors, eq(actors.id, threads.actorId))
      .where(and(eq(threads.id, data.id), eq(threads.hidden, false)))
      .get();
    if (!thread) notFound();
    const rows = this.rt.db.orm
      .select(postFields)
      .from(posts)
      .innerJoin(actors, eq(actors.id, posts.actorId))
      .where(and(eq(posts.threadId, data.id), eq(posts.hidden, false)))
      .orderBy(asc(posts.createdAt), sql`posts.rowid ASC`)
      .limit(data.pageSize + 1)
      .offset((data.page - 1) * data.pageSize)
      .all();
    return {
      thread,
      posts: rows.slice(0, data.pageSize),
      page: data.page,
      pageSize: data.pageSize,
      hasNext: rows.length > data.pageSize,
    };
  }
  createThread(principal: Principal | null, input: unknown) {
    const actor = this.rt.require(principal, 'forum:write');
    const data = parse(createThreadSchema, input);
    this.rt.writeRate(actor.id);
    return this.rt.db.sqlite
      .transaction(() => {
        const id = randomUUID();
        const createdAt = this.rt.timestamp();
        this.rt.db.orm
          .insert(threads)
          .values({ id, title: data.title, actorId: actor.id, createdAt, bumpedAt: createdAt })
          .run();
        this.rt.db.orm
          .insert(posts)
          .values({ id: randomUUID(), threadId: id, actorId: actor.id, body: data.body, createdAt })
          .run();
        this.rt.audit(actor.id, 'forum.create_thread', id);
        this.rt.event('forum.updated', id);
        return { id, actorId: actor.id };
      })
      .immediate();
  }
  reply(principal: Principal | null, input: unknown) {
    const actor = this.rt.require(principal, 'forum:write');
    const data = parse(replySchema, input);
    this.rt.writeRate(actor.id);
    return this.rt.db.sqlite
      .transaction(() => {
        const thread = this.rt.db.orm
          .select()
          .from(threads)
          .where(and(eq(threads.id, data.threadId), eq(threads.hidden, false)))
          .get();
        if (!thread) notFound();
        const id = randomUUID();
        const createdAt = this.rt.timestamp();
        this.rt.db.orm
          .insert(posts)
          .values({ id, threadId: data.threadId, actorId: actor.id, body: data.body, createdAt })
          .run();
        this.rt.db.orm
          .update(threads)
          .set({ bumpedAt: createdAt })
          .where(eq(threads.id, data.threadId))
          .run();
        this.rt.audit(actor.id, 'forum.reply', id);
        this.rt.event('forum.updated', data.threadId);
        return { id, actorId: actor.id };
      })
      .immediate();
  }
  moderate(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(
      z.strictObject({ kind: z.enum(['thread', 'post']), id: z.uuid(), hidden: z.boolean() }),
      input,
    );
    this.rt.db.sqlite
      .transaction(() => {
        const table = data.kind === 'thread' ? threads : posts;
        const current = this.rt.db.orm.select().from(table).where(eq(table.id, data.id)).get();
        if (!current) notFound();
        if (data.hidden && data.kind === 'post') {
          // The initial message defines the discussion; hiding it would leave an orphaned thread.
          const opening = this.rt.db.sqlite
            .prepare('SELECT id FROM posts WHERE thread_id = ? ORDER BY rowid ASC LIMIT 1')
            .get((current as typeof posts.$inferSelect).threadId) as { id: string } | undefined;
          if (opening?.id === data.id)
            throw new AppError(
              409,
              'OPENING_POST',
              'Hide the whole thread instead of its opening post',
            );
        }
        if (current.hidden === data.hidden) return; // One transition, one audit and event.
        this.rt.db.orm
          .update(table)
          .set({ hidden: data.hidden })
          .where(eq(table.id, data.id))
          .run();
        this.rt.audit(admin.id, 'forum.moderate', data.id, {
          hidden: data.hidden,
          kind: data.kind,
        });
        this.rt.event('forum.moderated', data.id);
      })
      .immediate();
  }
  moderationQueue(principal: Principal | null) {
    this.rt.admin(principal);
    return {
      threads: this.rt.db.orm
        .select()
        .from(threads)
        .orderBy(desc(threads.createdAt))
        .limit(100)
        .all(),
      posts: this.rt.db.orm
        .select({
          ...getTableColumns(posts),
          isOpeningPost: sql<number>`posts.rowid = (
            SELECT MIN(opening.rowid) FROM posts AS opening
            WHERE opening.thread_id = ${posts.threadId}
          )`,
        })
        .from(posts)
        .orderBy(desc(posts.createdAt))
        .limit(100)
        .all()
        .map((post) => ({ ...post, isOpeningPost: Boolean(post.isOpeningPost) })),
    };
  }
}
