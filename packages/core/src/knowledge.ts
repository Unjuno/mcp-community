import { randomUUID } from 'node:crypto';
import { actors, knowledgeResources, knowledgeRevisions, proposals } from '@mcp-community/database';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, notFound, parse } from './errors.js';
import type { Runtime } from './runtime.js';
import type { Principal } from './types.js';

const resourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const reference = z
  .url()
  .max(2048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const fields = {
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(50000),
  sources: z.array(reference).max(20).default([]),
};
export const getKnowledgeSchema = z.strictObject({ id: resourceId });
export const createKnowledgeSchema = z.strictObject({ id: resourceId, ...fields });
export const proposeKnowledgeSchema = z.strictObject({
  id: resourceId,
  baseRevision: z.number().int().min(1),
  ...fields,
  note: z.string().trim().max(2000).default(''),
});
export const proposalIdSchema = z.strictObject({
  id: z.uuid(),
  reason: z.string().trim().max(2000).optional(),
});
export const rejectProposalSchema = z.strictObject({
  id: z.uuid(),
  reason: z.string().trim().min(1).max(2000),
});
export const restoreKnowledgeSchema = getKnowledgeSchema.extend({
  revision: z.number().int().min(1),
  expectedRevision: z.number().int().min(1),
  reason: z.string().trim().min(1).max(2000),
});
const pagination = {
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
};
export const listProposalsSchema = z.strictObject({
  ...pagination,
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
const pageSchema = z.strictObject(pagination);
const historySchema = getKnowledgeSchema.extend(pagination);

export class Knowledge {
  constructor(private readonly rt: Runtime) {}
  list(principal: Principal | null, input: unknown = {}) {
    this.rt.require(principal, 'knowledge:read');
    const query = parse(pageSchema, input);
    const rows = this.rt.db.orm
      .select({
        id: knowledgeResources.id,
        title: knowledgeRevisions.title,
        currentRevision: knowledgeResources.currentRevision,
        updatedAt: knowledgeResources.updatedAt,
      })
      .from(knowledgeResources)
      .innerJoin(
        knowledgeRevisions,
        and(
          eq(knowledgeResources.id, knowledgeRevisions.resourceId),
          eq(knowledgeResources.currentRevision, knowledgeRevisions.number),
        ),
      )
      .orderBy(knowledgeResources.id)
      .limit(query.pageSize + 1)
      .offset((query.page - 1) * query.pageSize)
      .all();
    return {
      items: rows.slice(0, query.pageSize),
      ...query,
      hasNext: rows.length > query.pageSize,
    };
  }
  get(principal: Principal | null, input: unknown) {
    this.rt.require(principal, 'knowledge:read');
    const { id } = parse(getKnowledgeSchema, input);
    const resource = this.rt.db.orm
      .select({
        id: knowledgeResources.id,
        currentRevision: knowledgeResources.currentRevision,
        createdBy: knowledgeResources.createdBy,
        createdAt: knowledgeResources.createdAt,
        updatedBy: knowledgeResources.updatedBy,
        updatedAt: knowledgeResources.updatedAt,
        title: knowledgeRevisions.title,
        body: knowledgeRevisions.body,
        sources: knowledgeRevisions.sources,
      })
      .from(knowledgeResources)
      .innerJoin(
        knowledgeRevisions,
        and(
          eq(knowledgeResources.id, knowledgeRevisions.resourceId),
          eq(knowledgeResources.currentRevision, knowledgeRevisions.number),
        ),
      )
      .where(eq(knowledgeResources.id, id))
      .get();
    if (!resource) notFound();
    return resource;
  }
  history(principal: Principal | null, input: unknown) {
    this.rt.require(principal, 'knowledge:read');
    const query = parse(historySchema, input);
    this.get(principal, { id: query.id });
    const rows = this.rt.db.orm
      .select()
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.resourceId, query.id))
      .orderBy(desc(knowledgeRevisions.number))
      .limit(query.pageSize + 1)
      .offset((query.page - 1) * query.pageSize)
      .all();
    return {
      items: rows.slice(0, query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      hasNext: rows.length > query.pageSize,
    };
  }
  create(principal: Principal | null, input: unknown) {
    const actor = this.rt.admin(principal);
    const data = parse(createKnowledgeSchema, input);
    this.rt.writeRate(actor.id);
    return this.rt.db.sqlite
      .transaction(() => {
        if (
          this.rt.db.orm
            .select()
            .from(knowledgeResources)
            .where(eq(knowledgeResources.id, data.id))
            .get()
        )
          throw new AppError(409, 'RESOURCE_EXISTS', 'Knowledge resource already exists');
        const now = this.rt.timestamp();
        this.rt.db.orm
          .insert(knowledgeResources)
          .values({
            id: data.id,
            currentRevision: 1,
            createdBy: actor.id,
            updatedBy: actor.id,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        this.rt.db.orm
          .insert(knowledgeRevisions)
          .values({
            resourceId: data.id,
            number: 1,
            title: data.title,
            body: data.body,
            sources: data.sources,
            authorId: actor.id,
            reviewerId: actor.id,
            reason: 'Initial publication',
            restoredFrom: null,
            createdAt: now,
          })
          .run();
        this.rt.audit(actor.id, 'knowledge.create', data.id);
        this.rt.event('knowledge.updated', data.id);
        return this.get(principal, { id: data.id });
      })
      .immediate();
  }
  propose(principal: Principal | null, input: unknown) {
    const actor = this.rt.require(principal, 'knowledge:propose');
    const data = parse(proposeKnowledgeSchema, input);
    this.rt.writeRate(actor.id);
    return this.rt.db.sqlite
      .transaction(() => {
        if (
          !this.rt.db.orm
            .select()
            .from(knowledgeResources)
            .where(eq(knowledgeResources.id, data.id))
            .get()
        )
          notFound();
        // Foreign key enforces that a proposal's base revision actually exists.
        if (
          !this.rt.db.orm
            .select()
            .from(knowledgeRevisions)
            .where(
              and(
                eq(knowledgeRevisions.resourceId, data.id),
                eq(knowledgeRevisions.number, data.baseRevision),
              ),
            )
            .get()
        )
          notFound();
        const id = randomUUID();
        this.rt.db.orm
          .insert(proposals)
          .values({
            id,
            resourceId: data.id,
            baseRevision: data.baseRevision,
            title: data.title,
            body: data.body,
            sources: data.sources,
            note: data.note,
            authorId: actor.id,
            status: 'pending',
            createdAt: this.rt.timestamp(),
          })
          .run();
        this.rt.audit(actor.id, 'knowledge.propose', id, { resource: data.id });
        this.rt.event('proposal.created', id);
        return { id, status: 'pending' as const };
      })
      .immediate();
  }
  listProposals(principal: Principal | null, input: unknown = {}) {
    this.rt.require(principal, 'proposals:read');
    const query = parse(listProposalsSchema, input);
    const rows = this.rt.db.orm
      .select({
        id: proposals.id,
        resourceId: proposals.resourceId,
        baseRevision: proposals.baseRevision,
        title: proposals.title,
        authorId: proposals.authorId,
        authorName: actors.name,
        status: proposals.status,
        createdAt: proposals.createdAt,
      })
      .from(proposals)
      .innerJoin(actors, eq(actors.id, proposals.authorId))
      .where(query.status ? eq(proposals.status, query.status) : undefined)
      .orderBy(desc(proposals.createdAt), desc(proposals.id))
      .limit(query.pageSize + 1)
      .offset((query.page - 1) * query.pageSize)
      .all();
    return {
      items: rows.slice(0, query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      hasNext: rows.length > query.pageSize,
    };
  }
  getProposal(principal: Principal | null, input: unknown) {
    this.rt.require(principal, 'proposals:read');
    const { id } = parse(proposalIdSchema, typeof input === 'string' ? { id: input } : input);
    const proposal = this.rt.db.orm.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!proposal) notFound();
    const base = this.rt.db.orm
      .select()
      .from(knowledgeRevisions)
      .where(
        and(
          eq(knowledgeRevisions.resourceId, proposal.resourceId),
          eq(knowledgeRevisions.number, proposal.baseRevision),
        ),
      )
      .get();
    if (!base) notFound();
    const current = this.get(principal, { id: proposal.resourceId });
    return { proposal, base, currentRevision: current.currentRevision };
  }
  approve(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(proposalIdSchema, input);
    return this.rt.db.sqlite
      .transaction(() => {
        const proposal = this.rt.db.orm
          .select()
          .from(proposals)
          .where(eq(proposals.id, data.id))
          .get();
        if (!proposal) notFound();
        if (proposal.status !== 'pending')
          throw new AppError(409, 'PROPOSAL_RESOLVED', 'Proposal already resolved');
        if (proposal.authorId === admin.id)
          throw new AppError(403, 'SELF_APPROVAL', 'Author cannot approve own proposal');
        const current = this.rt.db.orm
          .select()
          .from(knowledgeResources)
          .where(eq(knowledgeResources.id, proposal.resourceId))
          .get();
        if (!current) notFound();
        if (current.currentRevision !== proposal.baseRevision)
          throw new AppError(409, 'REVISION_CONFLICT', 'Knowledge changed since proposal was made');
        const now = this.rt.timestamp();
        const next = current.currentRevision + 1;
        this.rt.db.orm
          .insert(knowledgeRevisions)
          .values({
            resourceId: proposal.resourceId,
            number: next,
            title: proposal.title,
            body: proposal.body,
            sources: proposal.sources,
            authorId: proposal.authorId,
            reviewerId: admin.id,
            reason: data.reason ?? proposal.note,
            restoredFrom: null,
            createdAt: now,
          })
          .run();
        this.rt.db.orm
          .update(knowledgeResources)
          .set({
            currentRevision: next,
            updatedBy: admin.id,
            updatedAt: now,
          })
          .where(eq(knowledgeResources.id, proposal.resourceId))
          .run();
        this.rt.db.orm
          .update(proposals)
          .set({
            status: 'approved',
            reviewerId: admin.id,
            decisionNote: data.reason ?? null,
            reviewedAt: now,
          })
          .where(eq(proposals.id, data.id))
          .run();
        this.rt.audit(admin.id, 'knowledge.approve', data.id, {
          resource: current.id,
          revision: next,
        });
        this.rt.event('knowledge.updated', current.id);
        return { id: current.id, currentRevision: next };
      })
      .immediate();
  }
  reject(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(rejectProposalSchema, input);
    return this.rt.db.sqlite
      .transaction(() => {
        const proposal = this.rt.db.orm
          .select()
          .from(proposals)
          .where(eq(proposals.id, data.id))
          .get();
        if (!proposal) notFound();
        if (proposal.status !== 'pending')
          throw new AppError(409, 'PROPOSAL_RESOLVED', 'Proposal already resolved');
        this.rt.db.orm
          .update(proposals)
          .set({
            status: 'rejected',
            reviewerId: admin.id,
            decisionNote: data.reason,
            reviewedAt: this.rt.timestamp(),
          })
          .where(eq(proposals.id, data.id))
          .run();
        this.rt.audit(admin.id, 'knowledge.reject', data.id);
        this.rt.event('proposal.resolved', data.id);
        return { id: data.id, status: 'rejected' as const };
      })
      .immediate();
  }
  restore(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(restoreKnowledgeSchema, input);
    return this.rt.db.sqlite
      .transaction(() => {
        const current = this.rt.db.orm
          .select()
          .from(knowledgeResources)
          .where(eq(knowledgeResources.id, data.id))
          .get();
        if (!current) notFound();
        if (current.currentRevision !== data.expectedRevision)
          throw new AppError(409, 'REVISION_CONFLICT', 'Knowledge changed since restoration began');
        const prior = this.rt.db.orm
          .select()
          .from(knowledgeRevisions)
          .where(
            and(
              eq(knowledgeRevisions.resourceId, data.id),
              eq(knowledgeRevisions.number, data.revision),
            ),
          )
          .get();
        if (!prior) notFound();
        const next = current.currentRevision + 1;
        const now = this.rt.timestamp();
        this.rt.db.orm
          .insert(knowledgeRevisions)
          .values({
            resourceId: data.id,
            number: next,
            title: prior.title,
            body: prior.body,
            sources: prior.sources,
            authorId: admin.id,
            reviewerId: admin.id,
            reason: data.reason,
            restoredFrom: data.revision,
            createdAt: now,
          })
          .run();
        this.rt.db.orm
          .update(knowledgeResources)
          .set({ currentRevision: next, updatedBy: admin.id, updatedAt: now })
          .where(eq(knowledgeResources.id, data.id))
          .run();
        this.rt.audit(admin.id, 'knowledge.restore', data.id, { from: data.revision, to: next });
        this.rt.event('knowledge.updated', data.id);
        return { id: data.id, currentRevision: next };
      })
      .immediate();
  }
}
