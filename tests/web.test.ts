import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookie, csrf, type Fixture, fixture, login, ORIGIN, PASSWORD } from './helpers.js';

let f: Fixture;
beforeEach(async () => {
  f = await fixture();
});
afterEach(() => f?.db.close());

describe('browser authentication and forum', () => {
  it('serves HTML in standards mode rather than browser quirks mode', async () => {
    const response = await f.app.request(`${ORIGIN}/login`);
    expect((await response.text()).startsWith('<!DOCTYPE html>')).toBe(true);
  });
  it('rotates a login session and sets secure cookie attributes', async () => {
    const session = await login(f.app);
    expect(session.cookie).not.toBe(session.guest);
    expect(session.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(session.response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(f.core.identity.session(session.guest.split('=')[1])).toBeNull();
  });
  it('rejects missing and cross-origin CSRF on login', async () => {
    const response = await f.app.request(`${ORIGIN}/login`);
    const cookies = cookie(response);
    const token = csrf(await response.text());
    const noToken = await f.app.request(`${ORIGIN}/login`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: cookies },
      body: new URLSearchParams({ username: 'admin', password: PASSWORD }),
    });
    expect(noToken.status).toBe(403);
    const wrongOrigin = await f.app.request(`${ORIGIN}/login`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', cookie: cookies },
      body: new URLSearchParams({ username: 'admin', password: PASSWORD, _csrf: token }),
    });
    expect(wrongOrigin.status).toBe(403);
  });
  it('rejects anonymous writes', async () => {
    const response = await f.app.request(`${ORIGIN}/threads`, {
      method: 'POST',
      headers: { origin: ORIGIN },
      body: new URLSearchParams({ title: 'No', body: 'No' }),
    });
    expect(response.status).toBe(401);
  });
  it('escapes stored XSS and renders the human author', async () => {
    const s = await login(f.app, 'member');
    const payload = '<script>alert("xss")</script>';
    const response = await f.app.request(`${ORIGIN}/threads`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: s.cookie },
      body: new URLSearchParams({ title: 'A safe title', body: payload, _csrf: s.csrf }),
    });
    expect(response.status).toBe(303);
    const page = await f.app.request(`${ORIGIN}${response.headers.get('location')}`, {
      headers: { cookie: s.cookie },
    });
    const html = await page.text();
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Human');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'none'");
  });
  it('rejects CSRF on reply and logout, then invalidates logout session', async () => {
    const s = await login(f.app);
    const thread = f.core.forum.createThread(f.memberContext, { title: 'A title', body: 'Text' });
    const reply = await f.app.request(`${ORIGIN}/threads/${thread.id}/replies`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: s.cookie },
      body: new URLSearchParams({ body: 'No CSRF' }),
    });
    expect(reply.status).toBe(403);
    const noToken = await f.app.request(`${ORIGIN}/logout`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: s.cookie },
      body: new URLSearchParams(),
    });
    expect(noToken.status).toBe(403);
    const logout = await f.app.request(`${ORIGIN}/logout`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie: s.cookie },
      body: new URLSearchParams({ _csrf: s.csrf }),
    });
    expect(logout.status).toBe(303);
    const denied = await f.app.request(`${ORIGIN}/threads`, { headers: { cookie: s.cookie } });
    expect(denied.status).toBe(303);
    expect(denied.headers.get('location')).toBe('/login');
  });
});
