import { createHash } from 'node:crypto';
import {
  actors,
  auditLogs,
  type Database,
  mutationReceipts,
  outboxEvents,
  rateLimits,
  tokens,
} from '@mcp-community/database';
import { and, eq, lt } from 'drizzle-orm';
import { AppError } from './errors.js';
import { credentialState } from './state-machines.js';
import { BASE_SCOPES, type Principal } from './types.js';

export class Runtime {
  readonly allowedScopes: ReadonlySet<string>;
  constructor(
    readonly db: Database,
    readonly now: () => number = Date.now,
    extensionScopes: readonly string[] = [],
  ) {
    this.allowedScopes = new Set([...BASE_SCOPES, ...extensionScopes]);
  }
  timestamp(): string {
    return new Date(this.now()).toISOString();
  }
  actor(principal: Principal | null) {
    if (!principal) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    const actor = this.db.orm.select().from(actors).where(eq(actors.id, principal.actorId)).get();
    if (!actor || actor.disabled)
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (actor.kind === 'agent') {
      const owner = actor.ownerId
        ? this.db.orm.select().from(actors).where(eq(actors.id, actor.ownerId)).get()
        : null;
      if (!owner || owner.disabled || owner.kind !== 'human')
        throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (principal.channel === 'mcp') this.accessToken(principal);
    else if (actor.kind !== 'human') throw new AppError(403, 'FORBIDDEN', 'Human account required');
    return actor;
  }
  private accessToken(principal: Principal) {
    const token = principal.tokenId
      ? this.db.orm.select().from(tokens).where(eq(tokens.id, principal.tokenId)).get()
      : null;
    if (
      !token ||
      token.actorId !== principal.actorId ||
      credentialState(token.expiresAt, token.revokedAt, this.now()) !== 'active'
    )
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    return token;
  }
  require(principal: Principal | null, scope: string) {
    const actor = this.actor(principal);
    if (!this.allowedScopes.has(scope))
      throw new AppError(403, 'INSUFFICIENT_SCOPE', 'Insufficient scope');
    if (principal?.channel === 'mcp' && !this.accessToken(principal).scopes.includes(scope))
      throw new AppError(403, 'INSUFFICIENT_SCOPE', 'Insufficient scope');
    return actor;
  }
  admin(principal: Principal | null) {
    const actor = this.actor(principal);
    if (actor.kind !== 'human' || actor.role !== 'admin' || principal?.channel === 'mcp')
      throw new AppError(403, 'FORBIDDEN', 'Human administrator required');
    return actor;
  }
  audit(
    actorId: string | null,
    action: string,
    target: string,
    metadata: Record<string, string | number | boolean> = {},
  ) {
    this.db.orm
      .insert(auditLogs)
      .values({ actorId, action, target, metadata, createdAt: this.timestamp() })
      .run();
  }
  event(kind: string, entityId: string) {
    this.db.orm.insert(outboxEvents).values({ kind, entityId, createdAt: this.timestamp() }).run();
  }
  rate(key: string, limit: number, windowMs: number) {
    const allowed = this.db.sqlite
      .transaction(() => {
        const now = this.now();
        this.db.orm.delete(rateLimits).where(lt(rateLimits.expiresAt, now)).run();
        const current = this.db.orm.select().from(rateLimits).where(eq(rateLimits.key, key)).get();
        if (current && current.expiresAt > now && current.count >= limit) return false;
        const count = current && current.expiresAt > now ? current.count + 1 : 1;
        const expiresAt = current && current.expiresAt > now ? current.expiresAt : now + windowMs;
        this.db.orm
          .insert(rateLimits)
          .values({ key, count, expiresAt })
          .onConflictDoUpdate({ target: rateLimits.key, set: { count, expiresAt } })
          .run();
        return true;
      })
      .immediate();
    if (!allowed) throw new AppError(429, 'RATE_LIMITED', 'Rate limit exceeded');
  }
  /** Atomically associate a client retry key with one committed mutation result.
   * Callers must authenticate and authorize before reaching this method. Retries
   * still count toward request throttling at their service entry point.
   */
  idempotently<T>(
    actorId: string,
    operation: 'forum.create_thread' | 'forum.reply' | 'knowledge.propose',
    idempotencyKey: string | undefined,
    payload: unknown,
    mutate: () => T,
  ): T {
    return this.db.sqlite
      .transaction(() => {
        if (idempotencyKey) {
          const requestHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
          const existing = this.db.orm
            .select()
            .from(mutationReceipts)
            .where(
              and(
                eq(mutationReceipts.actorId, actorId),
                eq(mutationReceipts.operation, operation),
                eq(mutationReceipts.idempotencyKey, idempotencyKey),
              ),
            )
            .get();
          if (existing) {
            if (existing.requestHash !== requestHash)
              throw new AppError(
                409,
                'IDEMPOTENCY_CONFLICT',
                'Retry key was used with different input',
              );
            return JSON.parse(existing.responseJson) as T;
          }
          const result = mutate();
          this.db.orm
            .insert(mutationReceipts)
            .values({
              actorId,
              operation,
              idempotencyKey,
              requestHash,
              responseJson: JSON.stringify(result),
              createdAt: this.timestamp(),
            })
            .run();
          return result;
        }
        return mutate();
      })
      .immediate();
  }

  writeRate(actorId: string) {
    this.rate(`write:${actorId}`, 30, 60000);
  }
}
