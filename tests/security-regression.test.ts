import { Community } from '@mcp-community/core';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { hashPassword } from '../packages/core/src/crypto.js';
import { fixture, login, ORIGIN, PASSWORD } from './helpers.js';

describe('security regression boundaries', () => {
  it('stores SQL-looking input as data and rolls back a write if its audit insert fails', async () => {
    const f = await fixture();
    try {
      const title = "'); DROP TABLE users; --";
      const created = f.core.forum.createThread(f.memberContext, { title, body: title });
      expect(f.core.forum.getThread(f.memberContext, { id: created.id }).thread.title).toBe(title);
      expect(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 2 });
      f.db.sqlite.exec(
        "CREATE TRIGGER deny_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;",
      );
      expect(() =>
        f.core.forum.createThread(f.memberContext, {
          title: 'Must rollback',
          body: 'Do not publish',
        }),
      ).toThrow();
      expect(f.core.forum.listThreads(f.memberContext).items).toHaveLength(1);
    } finally {
      f.db.close();
    }
  });
  it('enforces login throttling and expired token/session boundaries', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 10; i++)
        await expect(
          f.core.identity.login(
            { username: 'member', password: 'Wrong-password-for-test' },
            'single-client',
          ),
        ).rejects.toMatchObject({ status: 401 });
      await expect(
        f.core.identity.login({ username: 'member', password: PASSWORD }, 'single-client'),
      ).rejects.toMatchObject({ status: 429 });
      const agent = f.core.identity.createAgent(f.adminContext, {
        name: 'Expires',
        expiresInDays: 1,
      });
      const logged = await f.core.identity.login(
        { username: 'admin', password: PASSWORD },
        'other-client',
      );
      const future = new Community(f.db, { now: () => Date.now() + 2 * 86400000 });
      expect(() => future.identity.authenticateToken(agent.token)).toThrow();
      expect(future.identity.session(logged.token)).toBeNull();
    } finally {
      f.db.close();
    }
  });
  it('sets production cookies to Secure and refuses non-HTTPS production configuration', async () => {
    const f = await fixture();
    try {
      expect(() => createApp({ db: f.db, origin: ORIGIN, production: true })).toThrow(/HTTPS/);
      const app = createApp({
        db: f.db,
        core: f.core,
        origin: 'https://community.example',
        production: true,
      });
      const r = await app.request('https://community.example/login');
      expect(r.headers.get('set-cookie')).toContain('__Host-mcc_session=');
      expect(r.headers.get('set-cookie')).toContain('Secure');
      expect(r.headers.get('set-cookie')).toContain('HttpOnly');
      expect(r.headers.get('strict-transport-security')).toContain('max-age=');
    } finally {
      f.db.close();
    }
  });
  it('rejects member admin routes and protects proposal review and restore against forged requests', async () => {
    const f = await fixture();
    try {
      const member = await login(f.app, 'member');
      expect(
        (await f.app.request(`${ORIGIN}/admin`, { headers: { cookie: member.cookie } })).status,
      ).toBe(403);
      const admin = await login(f.app);
      f.core.knowledge.create(f.adminContext, {
        id: 'secure',
        title: 'Secure',
        body: 'Before',
        sources: [],
      });
      for (const path of ['/admin/agents', '/admin/moderate', '/knowledge/secure/restore']) {
        expect(
          (
            await f.app.request(`${ORIGIN}${path}`, {
              method: 'POST',
              headers: { cookie: admin.cookie, origin: 'https://attacker.invalid' },
              body: new URLSearchParams({ _csrf: admin.csrf }),
            })
          ).status,
        ).toBe(403);
      }
    } finally {
      f.db.close();
    }
  });
  it('does not disclose input, credentials or SQL details in failure responses or server logs', async () => {
    const f = await fixture();
    const logs: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args);
    });
    try {
      const admin = await login(f.app);
      const secret = 'never-log-this-private-post';
      f.db.sqlite.exec(
        "CREATE TRIGGER deny_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'secret-internal-database-location'); END;",
      );
      const r = await f.app.request(`${ORIGIN}/threads`, {
        method: 'POST',
        headers: { cookie: admin.cookie, origin: ORIGIN },
        body: new URLSearchParams({ _csrf: admin.csrf, title: secret, body: secret }),
      });
      expect(r.status).toBe(500);
      const combined = (await r.text()) + JSON.stringify(logs);
      for (const hidden of [
        secret,
        admin.cookie,
        admin.csrf,
        'secret-internal-database-location',
        PASSWORD,
      ])
        expect(combined).not.toContain(hidden);
    } finally {
      spy.mockRestore();
      f.db.close();
    }
  });
  it('invalidates sessions after a password reset and rejects disabled users and their agents', async () => {
    const f = await fixture();
    try {
      const session = await f.core.identity.login(
        { username: 'member', password: PASSWORD },
        'reset-test',
      );
      await f.core.identity.resetPassword(f.adminContext, {
        actorId: f.member.id,
        password: 'Replacement-test-passphrase!',
      });
      expect(f.core.identity.session(session.token)).toBeNull();
      await expect(
        f.core.identity.login({ username: 'member', password: PASSWORD }, 'reset-test'),
      ).rejects.toMatchObject({ status: 401 });
      const agent = f.core.identity.createAgent(f.adminContext, { name: 'Owned agent' });
      const second = await f.core.identity.createHuman(f.adminContext, {
        username: 'otheradmin',
        name: 'Other admin',
        role: 'admin',
        password: PASSWORD,
      });
      const secondAdmin = { actorId: second.id, channel: 'cli' as const, scopes: [] };
      f.core.identity.setDisabled(secondAdmin, { actorId: f.admin.id, disabled: true });
      expect(() => f.core.identity.authenticateToken(agent.token)).toThrow();
      expect(() =>
        f.core.identity.createAgent(f.adminContext, { name: 'No longer allowed' }),
      ).toThrow();
    } finally {
      f.db.close();
    }
  });
});

describe('concurrent identity changes', () => {
  it('does not create a new session from a password invalidated during hashing', async () => {
    const f = await fixture();
    try {
      const changedHash = await hashPassword('Changed-during-login-passphrase!');
      const attempt = f.core.identity.login(
        { username: 'member', password: PASSWORD },
        'race-test',
      );
      f.db.sqlite
        .prepare('UPDATE users SET password_hash = ? WHERE actor_id = ?')
        .run(changedHash, f.member.id);
      await expect(attempt).rejects.toMatchObject({ status: 401 });
    } finally {
      f.db.close();
    }
  });
});

describe('unauthenticated protocol throttling', () => {
  it('limits invalid MCP authentication before invoking the SDK', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 300; i++) {
        const r = await f.app.request(`${ORIGIN}/mcp`, { method: 'POST' });
        expect(r.status).toBe(401);
      }
      expect((await f.app.request(`${ORIGIN}/mcp`, { method: 'POST' })).status).toBe(429);
    } finally {
      f.db.close();
    }
  });
});
