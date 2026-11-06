import { randomUUID } from 'node:crypto';
import { actors, sessions, tokens, users } from '@mcp-community/database';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { hashPassword, hashSecret, secret, verifyPassword } from './crypto.js';
import { AppError, notFound, parse } from './errors.js';
import type { Runtime } from './runtime.js';
import { DEFAULT_AGENT_SCOPES, type Principal } from './types.js';

const humanInput = z.strictObject({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{2,31}$/),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(128),
  role: z.enum(['member', 'admin']).default('member'),
});
const agentInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.string().max(100)).min(1).max(30).default(DEFAULT_AGENT_SCOPES),
  expiresInDays: z.number().int().min(1).max(90).default(30),
});
let dummyHash: Promise<string> | undefined;
export interface SessionState {
  principal: Principal | null;
  csrf: string;
  expiresAt: number;
}

export class Identity {
  constructor(private readonly rt: Runtime) {}
  async bootstrapAdmin(input: unknown) {
    const data = parse(humanInput, {
      ...(typeof input === 'object' && input !== null ? input : {}),
      role: 'admin',
    });
    const passwordHash = await hashPassword(data.password);
    return this.rt.db.sqlite
      .transaction(() => {
        if (this.rt.db.orm.select({ id: actors.id }).from(actors).get())
          throw new AppError(409, 'ALREADY_INITIALIZED', 'Administrator already initialized');
        return this.insertHuman(data, passwordHash, null);
      })
      .immediate();
  }
  async createHuman(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(humanInput, input);
    const passwordHash = await hashPassword(data.password);
    return this.rt.db.sqlite
      .transaction(() => {
        this.rt.admin(principal);
        return this.insertHuman(data, passwordHash, admin.id);
      })
      .immediate();
  }
  private insertHuman(
    data: z.output<typeof humanInput>,
    passwordHash: string,
    performedBy: string | null,
  ) {
    if (this.rt.db.orm.select().from(users).where(eq(users.username, data.username)).get())
      throw new AppError(409, 'CONFLICT', 'Username already exists');
    const actor = {
      id: randomUUID(),
      name: data.name,
      kind: 'human' as const,
      role: data.role,
      ownerId: null,
      disabled: false,
      createdAt: this.rt.timestamp(),
    };
    this.rt.db.orm.insert(actors).values(actor).run();
    this.rt.db.orm
      .insert(users)
      .values({ actorId: actor.id, username: data.username, passwordHash })
      .run();
    this.rt.audit(
      performedBy ?? actor.id,
      performedBy ? 'identity.create_human' : 'identity.bootstrap_admin',
      actor.id,
    );
    return actor;
  }
  actor(principal: Principal | null) {
    return this.rt.actor(principal);
  }
  admin(principal: Principal | null) {
    return this.rt.admin(principal);
  }
  byUsername(username: string) {
    return (
      this.rt.db.orm
        .select({
          id: actors.id,
          name: actors.name,
          role: actors.role,
          kind: actors.kind,
          disabled: actors.disabled,
        })
        .from(users)
        .innerJoin(actors, eq(users.actorId, actors.id))
        .where(eq(users.username, username.toLowerCase()))
        .get() ?? null
    );
  }
  createAgent(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(agentInput, input);
    this.validateScopes(data.scopes);
    return this.rt.db.sqlite
      .transaction(() => {
        const actor = {
          id: randomUUID(),
          name: data.name,
          kind: 'agent' as const,
          role: 'member' as const,
          ownerId: admin.id,
          disabled: false,
          createdAt: this.rt.timestamp(),
        };
        this.rt.db.orm.insert(actors).values(actor).run();
        this.rt.audit(admin.id, 'identity.create_agent', actor.id);
        return { actor, ...this.newToken(admin.id, actor.id, data.scopes, data.expiresInDays) };
      })
      .immediate();
  }
  issueToken(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(
      z.strictObject({
        actorId: z.uuid(),
        scopes: z.array(z.string()).min(1).max(30),
        expiresInDays: z.number().int().min(1).max(90).default(30),
      }),
      input,
    );
    this.validateScopes(data.scopes);
    const actor = this.rt.db.orm
      .select()
      .from(actors)
      .where(and(eq(actors.id, data.actorId), eq(actors.kind, 'agent'), eq(actors.disabled, false)))
      .get();
    if (!actor) notFound();
    return this.rt.db.sqlite
      .transaction(() => this.newToken(admin.id, actor.id, data.scopes, data.expiresInDays))
      .immediate();
  }
  private validateScopes(scopes: string[]) {
    if (new Set(scopes).size !== scopes.length || scopes.some((s) => !this.rt.allowedScopes.has(s)))
      throw new AppError(400, 'INVALID_SCOPE', 'Unknown or duplicate scope');
  }
  private newToken(performedBy: string, actorId: string, scopes: string[], days: number) {
    const token = `mcc_${secret()}`;
    const tokenId = randomUUID();
    const expiresAt = this.rt.now() + days * 86400000;
    this.rt.db.orm
      .insert(tokens)
      .values({
        id: tokenId,
        actorId,
        hash: hashSecret(token),
        scopes,
        expiresAt,
        revokedAt: null,
        createdAt: this.rt.timestamp(),
      })
      .run();
    this.rt.audit(performedBy, 'identity.issue_token', tokenId, { scopeCount: scopes.length });
    return { token, tokenId, expiresAt };
  }
  authenticateToken(raw: string | undefined): Principal {
    if (!raw || !/^mcc_[A-Za-z0-9_-]{43}$/.test(raw))
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    const token = this.rt.db.orm
      .select()
      .from(tokens)
      .where(eq(tokens.hash, hashSecret(raw)))
      .get();
    if (!token || token.revokedAt !== null || token.expiresAt <= this.rt.now())
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    const principal: Principal = {
      actorId: token.actorId,
      channel: 'mcp',
      scopes: token.scopes,
      tokenId: token.id,
    };
    try {
      this.rt.actor(principal);
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid access token');
    }
    return principal;
  }
  async resetPassword(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(
      z.strictObject({ actorId: z.uuid(), password: z.string().min(12).max(128) }),
      input,
    );
    const passwordHash = await hashPassword(data.password);
    this.rt.db.sqlite
      .transaction(() => {
        this.rt.admin(principal); // Recheck after asynchronous password hashing.
        const updated = this.rt.db.orm
          .update(users)
          .set({ passwordHash })
          .where(eq(users.actorId, data.actorId))
          .run();
        if (!updated.changes) notFound();
        this.rt.db.orm.delete(sessions).where(eq(sessions.actorId, data.actorId)).run();
        this.rt.audit(admin.id, 'identity.reset_password', data.actorId);
      })
      .immediate();
  }
  setDisabled(principal: Principal | null, input: unknown) {
    const admin = this.rt.admin(principal);
    const data = parse(z.strictObject({ actorId: z.uuid(), disabled: z.boolean() }), input);
    if (data.actorId === admin.id && data.disabled)
      throw new AppError(400, 'SELF_DISABLE', 'An administrator cannot disable their own account');
    this.rt.db.sqlite
      .transaction(() => {
        const changed = this.rt.db.orm
          .update(actors)
          .set({ disabled: data.disabled })
          .where(eq(actors.id, data.actorId))
          .run();
        if (!changed.changes) notFound();
        if (data.disabled)
          this.rt.db.orm.delete(sessions).where(eq(sessions.actorId, data.actorId)).run();
        this.rt.audit(admin.id, 'identity.set_disabled', data.actorId, { disabled: data.disabled });
      })
      .immediate();
  }
  revokeToken(principal: Principal | null, id: unknown) {
    const admin = this.rt.admin(principal);
    const tokenId = parse(z.uuid(), id);
    this.rt.db.sqlite
      .transaction(() => {
        const token = this.rt.db.orm.select().from(tokens).where(eq(tokens.id, tokenId)).get();
        if (!token) notFound();
        this.rt.db.orm
          .update(tokens)
          .set({ revokedAt: this.rt.now() })
          .where(eq(tokens.id, tokenId))
          .run();
        this.rt.audit(admin.id, 'identity.revoke_token', tokenId);
      })
      .immediate();
  }
  listTokens(principal: Principal | null) {
    this.rt.admin(principal);
    return this.rt.db.orm
      .select({
        id: tokens.id,
        actorId: tokens.actorId,
        name: actors.name,
        scopes: tokens.scopes,
        expiresAt: tokens.expiresAt,
        revokedAt: tokens.revokedAt,
      })
      .from(tokens)
      .innerJoin(actors, eq(tokens.actorId, actors.id))
      .limit(100)
      .all();
  }
  async login(input: unknown, clientAddress: string, previousSession?: string) {
    const data = parse(
      z.strictObject({
        username: z.string().trim().toLowerCase().min(1).max(32),
        password: z.string().min(1).max(128),
      }),
      input,
    );
    this.rt.rate(`login-ip:${hashSecret(clientAddress)}`, 30, 900000);
    this.rt.rate(`login-user:${hashSecret(data.username)}`, 10, 900000);
    const user = this.rt.db.orm.select().from(users).where(eq(users.username, data.username)).get();
    dummyHash ??= hashPassword(secret());
    const ok = await verifyPassword(data.password, user?.passwordHash ?? (await dummyHash));
    const actor = user
      ? this.rt.db.orm.select().from(actors).where(eq(actors.id, user.actorId)).get()
      : null;
    if (!ok || !actor || actor.disabled || actor.kind !== 'human') {
      this.rt.audit(null, 'auth.login_failed', 'login');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }
    return this.rt.db.sqlite
      .transaction(() => {
        const currentUser = this.rt.db.orm
          .select()
          .from(users)
          .where(eq(users.actorId, actor.id))
          .get();
        const currentActor = this.rt.db.orm
          .select()
          .from(actors)
          .where(eq(actors.id, actor.id))
          .get();
        if (
          !currentUser ||
          currentUser.passwordHash !== user?.passwordHash ||
          !currentActor ||
          currentActor.disabled ||
          currentActor.kind !== 'human'
        )
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        if (previousSession)
          this.rt.db.orm
            .delete(sessions)
            .where(eq(sessions.hash, hashSecret(previousSession)))
            .run();
        const session = this.createSession(actor.id);
        this.rt.audit(actor.id, 'auth.login', actor.id);
        return session;
      })
      .immediate();
  }
  guestSession(clientAddress: string) {
    this.rt.rate(`guest:${hashSecret(clientAddress)}`, 120, 3600000);
    return this.createSession(null);
  }
  private createSession(actorId: string | null) {
    const token = secret();
    const csrf = secret();
    const expiresAt = this.rt.now() + (actorId ? 43200000 : 900000);
    this.rt.db.orm.delete(sessions).where(lt(sessions.expiresAt, this.rt.now())).run();
    this.rt.db.orm
      .insert(sessions)
      .values({ hash: hashSecret(token), actorId, csrf, expiresAt })
      .run();
    return { token, csrf, expiresAt };
  }
  session(raw: string | undefined): SessionState | null {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const session = this.rt.db.orm
      .select()
      .from(sessions)
      .where(eq(sessions.hash, hashSecret(raw)))
      .get();
    if (!session || session.expiresAt <= this.rt.now()) return null;
    const principal: Principal | null = session.actorId
      ? { actorId: session.actorId, channel: 'web', scopes: [] }
      : null;
    if (principal) {
      try {
        this.rt.actor(principal);
      } catch {
        return null;
      }
    }
    return { principal, csrf: session.csrf, expiresAt: session.expiresAt };
  }
  logout(raw: string | undefined) {
    if (!raw) return;
    const state = this.session(raw);
    this.rt.db.sqlite
      .transaction(() => {
        this.rt.db.orm
          .delete(sessions)
          .where(eq(sessions.hash, hashSecret(raw)))
          .run();
        if (state?.principal)
          this.rt.audit(state.principal.actorId, 'auth.logout', state.principal.actorId);
      })
      .immediate();
  }
}
