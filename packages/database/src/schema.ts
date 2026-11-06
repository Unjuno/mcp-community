import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const actors = sqliteTable('actors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['human', 'agent'] }).notNull(),
  role: text('role', { enum: ['member', 'admin'] })
    .notNull()
    .default('member'),
  ownerId: text('owner_id'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});
export const users = sqliteTable('users', {
  actorId: text('actor_id')
    .primaryKey()
    .references(() => actors.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
});
export const sessions = sqliteTable('sessions', {
  hash: text('hash').primaryKey(),
  actorId: text('actor_id').references(() => actors.id),
  csrf: text('csrf').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const tokens = sqliteTable('tokens', {
  id: text('id').primaryKey(),
  actorId: text('actor_id')
    .notNull()
    .references(() => actors.id),
  hash: text('hash').notNull().unique(),
  scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: text('created_at').notNull(),
});
export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    bumpedAt: text('bumped_at').notNull(),
  },
  (t) => [index('threads_bumped_idx').on(t.bumpedAt, t.id)],
);
export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id),
    body: text('body').notNull(),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('posts_thread_idx').on(t.threadId, t.createdAt, t.id)],
);
export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  target: text('target').notNull(),
  metadata: text('metadata', { mode: 'json' })
    .$type<Record<string, string | number | boolean>>()
    .notNull(),
  createdAt: text('created_at').notNull(),
});
export const outboxEvents = sqliteTable('outbox_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  entityId: text('entity_id').notNull(),
  createdAt: text('created_at').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export type Actor = typeof actors.$inferSelect;

export const knowledgeResources = sqliteTable('knowledge_resources', {
  id: text('id').primaryKey(),
  currentRevision: integer('current_revision').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => actors.id),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => actors.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const knowledgeRevisions = sqliteTable(
  'knowledge_revisions',
  {
    resourceId: text('resource_id')
      .notNull()
      .references(() => knowledgeResources.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    sources: text('sources', { mode: 'json' }).$type<string[]>().notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => actors.id),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => actors.id),
    reason: text('reason').notNull(),
    restoredFrom: integer('restored_from'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.resourceId, t.number] })],
);
export const proposals = sqliteTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => knowledgeResources.id),
    baseRevision: integer('base_revision').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    sources: text('sources', { mode: 'json' }).$type<string[]>().notNull(),
    note: text('note').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => actors.id),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    reviewerId: text('reviewer_id').references(() => actors.id),
    decisionNote: text('decision_note'),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('proposals_status_idx').on(t.status, t.createdAt)],
);
