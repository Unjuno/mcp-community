import {
  AppError,
  Community,
  type Principal,
  type SessionState,
  safeEqual,
} from '@mcp-community/core';
import type { Database } from '@mcp-community/database';
import { handleMcp } from '@mcp-community/mcp';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { registerKnowledgeRoutes } from './knowledge-web.js';
import { styles } from './styles.js';
import { ErrorPage } from './views.js';
import { registerWebRoutes } from './web.js';

export interface AppOptions {
  db: Database;
  origin: string;
  production: boolean;
  core?: Community;
  clientAddress?: (request: Request) => string;
}
export type WebEnvironment = {
  Variables: {
    principal: Principal | null;
    session: SessionState | null;
    sessionToken: string | undefined;
    csrf: string;
    form: Record<string, string>;
  };
};
export function createApp(options: AppOptions) {
  const core = options.core ?? new Community(options.db);
  const configured = new URL(options.origin);
  if (
    configured.pathname !== '/' ||
    configured.search ||
    configured.hash ||
    configured.username ||
    configured.password ||
    !['http:', 'https:'].includes(configured.protocol)
  )
    throw new Error('APP_ORIGIN must be a plain HTTP(S) origin');
  if (options.production && configured.protocol !== 'https:')
    throw new Error('Production requires HTTPS');
  const origin = configured.origin;
  const cookieName = options.production ? '__Host-mcc_session' : 'mcc_session';
  const app = new Hono<WebEnvironment>();
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    if (options.production) c.header('Strict-Transport-Security', 'max-age=31536000');
    if (c.req.path !== '/health') {
      const host = c.req.header('host') ?? new URL(c.req.url).host;
      if (host !== configured.host) throw new AppError(403, 'INVALID_HOST', 'Unrecognized host');
    }
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 262144, onError: (c) => c.text('Request too large', 413) }));
  app.get('/health', (c) => {
    options.db.sqlite.prepare('SELECT 1').get();
    return c.json({ status: 'ok' });
  });
  app.get('/assets/style.css', (c) =>
    c.body(styles, 200, { 'Content-Type': 'text/css; charset=utf-8' }),
  );
  app.all('/mcp', (c) => handleMcp(c.req.raw, core, origin));
  app.use('*', async (c, next) => {
    let raw = getCookie(c, cookieName);
    let session = core.identity.session(raw);
    if (c.req.path === '/login' && c.req.method === 'GET' && !session) {
      const guest = core.identity.guestSession(options.clientAddress?.(c.req.raw) ?? 'local');
      raw = guest.token;
      session = core.identity.session(raw);
      setCookie(c, cookieName, raw, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: options.production,
        path: '/',
        maxAge: 900,
      });
    }
    c.set('session', session);
    c.set('sessionToken', raw);
    c.set('principal', session?.principal ?? null);
    c.set('csrf', session?.csrf ?? '');
    if (c.req.path !== '/login' && !session?.principal) {
      if (c.req.method === 'GET') return c.redirect('/login', 303);
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (c.req.header('origin') !== origin || !session)
        throw new AppError(403, 'CSRF', 'CSRF verification failed');
      if (!(c.req.header('content-type') ?? '').startsWith('application/x-www-form-urlencoded'))
        throw new AppError(400, 'INVALID_INPUT', 'Expected form data');
      const rawForm = await c.req.parseBody();
      const form: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawForm)) {
        if (typeof value !== 'string')
          throw new AppError(400, 'INVALID_INPUT', 'Invalid form data');
        form[key] = value;
      }
      if (!form._csrf || !safeEqual(form._csrf, session.csrf))
        throw new AppError(403, 'CSRF', 'CSRF verification failed');
      c.set('form', form);
    }
    await next();
  });
  const setSession = (c: Parameters<typeof setCookie>[0], token: string) =>
    setCookie(c, cookieName, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: options.production,
      path: '/',
      maxAge: 43200,
    });
  const clearSession = (c: Parameters<typeof deleteCookie>[0]) =>
    deleteCookie(c, cookieName, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: options.production,
      path: '/',
    });
  registerWebRoutes(app, core, {
    setSession,
    clearSession,
    clientAddress: options.clientAddress ?? (() => 'local'),
  });
  registerKnowledgeRoutes(app, core);
  app.onError((error, c) => {
    if (error instanceof AppError)
      return c.html(ErrorPage({ status: error.status, message: error.message }), error.status);
    console.error(JSON.stringify({ event: 'request_error', code: 'INTERNAL' }));
    return c.html(ErrorPage({ status: 500, message: 'Internal server error' }), 500);
  });
  app.notFound((c) => c.html(ErrorPage({ status: 404, message: 'Not found' }), 404));
  return app;
}
