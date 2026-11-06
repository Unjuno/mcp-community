import { Community, type Principal } from '@mcp-community/core';
import { openDatabase } from '@mcp-community/database';
import { createApp } from '../apps/server/src/app.js';

export const PASSWORD = 'Tests-only-strong-passphrase!';
export const ORIGIN = 'http://localhost:3000';
export async function fixture() {
  const db = openDatabase(':memory:');
  const core = new Community(db);
  const admin = await core.identity.bootstrapAdmin({
    username: 'admin',
    name: 'Administrator',
    password: PASSWORD,
  });
  const adminContext: Principal = { actorId: admin.id, channel: 'cli', scopes: [] };
  const member = await core.identity.createHuman(adminContext, {
    username: 'member',
    name: 'Member',
    password: PASSWORD,
    role: 'member',
  });
  const memberContext: Principal = { actorId: member.id, channel: 'web', scopes: [] };
  const app = createApp({ db, origin: ORIGIN, production: false, core });
  return { db, core, admin, member, adminContext, memberContext, app };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export function cookie(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
export function csrf(html: string): string {
  const token = /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error('CSRF token absent from rendered form');
  return token;
}
export async function login(app: ReturnType<typeof createApp>, username = 'admin') {
  const form = await app.request(`${ORIGIN}/login`);
  const guest = cookie(form);
  const token = csrf(await form.text());
  const response = await app.request(`${ORIGIN}/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, cookie: guest },
    body: new URLSearchParams({ username, password: PASSWORD, _csrf: token }),
  });
  if (response.status !== 303) throw new Error(`Login failed with ${response.status}`);
  const authenticated = cookie(response);
  const page = await app.request(`${ORIGIN}/threads`, { headers: { cookie: authenticated } });
  return { cookie: authenticated, csrf: csrf(await page.text()), guest, response };
}
