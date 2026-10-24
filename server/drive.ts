// Google Drive sign-in for cloud sync. Maps go straight between the browser and the user's own Drive; the
// server only does the OAuth code exchange (it needs the client secret) and hands the browser short-lived
// access tokens. The refresh token isn't stored here: it lives in an encrypted httpOnly cookie in that browser.
// Only the drive.file scope is requested, so the app can see nothing but the files it created.
import { randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Env } from './app.ts';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sealer } from './seal.ts';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const COOKIE = 'gdrive';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface DriveOptions {
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  secureCookies: boolean;
}

export function driveRoutes(app: Hono<Env>, o: DriveOptions) {
  const redirectUri = `${o.publicUrl}/api/drive/callback`;
  // The cookie's key is derived from the client secret: rotating the secret signs everyone out.
  const { seal, open } = sealer(o.clientSecret, 'drive-cookie');
  const cookieOpts = { httpOnly: true, sameSite: 'Lax' as const, secure: o.secureCookies, path: '/' };

  const refreshToken = (c: Context) => {
    const v = getCookie(c, COOKIE);
    return v ? open(v) : null;
  };

  const token = (params: Record<string, string>) =>
    fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, ...params }),
    });

  app.get('/api/drive/login', (c) => {
    const state = randomBytes(16).toString('hex');
    const ret = c.req.query('return') ?? '/';
    setCookie(c, 'drive_state', state, { ...cookieOpts, maxAge: 600 });
    setCookie(c, 'drive_return', ret.startsWith('/') && !ret.startsWith('//') ? ret : '/', { ...cookieOpts, maxAge: 600 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', o.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPE);
    // offline + consent: Google only returns a refresh token on a fresh consent.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return c.redirect(url.toString());
  });

  app.get('/api/drive/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const expected = getCookie(c, 'drive_state');
    const ret = getCookie(c, 'drive_return') ?? '/';
    deleteCookie(c, 'drive_state', cookieOpts);
    deleteCookie(c, 'drive_return', cookieOpts);
    const back = (result: string) => c.redirect(`${o.publicUrl}${ret}${ret.includes('?') ? '&' : '?'}drive=${result}`);
    if (c.req.query('error')) return back('cancelled');
    if (!code || !state || state !== expected) return c.text('Invalid sign-in state. Please try connecting Google Drive again.', 400);
    const res = await token({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    if (!res.ok) return c.text(`Google sign-in failed (${res.status}).`, 502);
    const t = (await res.json()) as { refresh_token?: string; scope?: string };
    // Google lets people untick the Drive permission on the consent screen.
    if (!t.scope?.split(' ').includes(SCOPE)) return back('noscope');
    if (!t.refresh_token) return c.text('Google did not return a refresh token. Please try connecting again.', 502);
    setCookie(c, COOKIE, seal(t.refresh_token), { ...cookieOpts, maxAge: COOKIE_MAX_AGE });
    return back('connected');
  });

  // A short-lived access token for the Drive API (POST, so the cross-origin check applies).
  app.post('/api/drive/token', async (c) => {
    const rt = refreshToken(c);
    if (!rt) return c.text('Google Drive is not connected', 401);
    const res = await token({ refresh_token: rt, grant_type: 'refresh_token' });
    if (!res.ok) {
      // invalid_grant: access was revoked, or the token expired.
      if (res.status === 400 || res.status === 401) {
        deleteCookie(c, COOKIE, cookieOpts);
        return c.text('Google Drive access was removed. Connect it again to keep syncing.', 401);
      }
      return c.text(`Google token refresh failed (${res.status})`, 502);
    }
    const t = (await res.json()) as { access_token: string; expires_in: number };
    return c.json({ accessToken: t.access_token, expiresIn: t.expires_in }, 200, { 'Cache-Control': 'no-store' });
  });

  app.post('/api/drive/logout', async (c) => {
    const rt = refreshToken(c);
    if (rt) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: rt }),
      }).catch(() => {});
    }
    deleteCookie(c, COOKIE, cookieOpts);
    return c.json({ ok: true });
  });

  return { connected: (c: Context) => refreshToken(c) !== null };
}
