// The API as a plain Hono app: osu! OAuth login and sessions, and Google Drive sign-in for cloud sync.
// Shared by the Vercel function (api/index.ts) and the standalone Node server (server/index.ts).
// Beatmaps never pass through here: the browser syncs them straight to the user's own Google Drive (drive.ts).
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { openDb, type Db, type UserRow } from './db.ts';
import { driveRoutes } from './drive.ts';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 365;

export type Env = { Variables: Record<string, never> };

export function createApp() {
  const env = process.env;
  const CLIENT_ID = env.OSU_CLIENT_ID ?? '';
  const CLIENT_SECRET = env.OSU_CLIENT_SECRET ?? '';
  const PUBLIC_URL = (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const REDIRECT_URI = env.OSU_REDIRECT_URI ?? `${PUBLIC_URL}/api/auth/callback`;
  const SECURE_COOKIES = PUBLIC_URL.startsWith('https://');
  const db: Db | null = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? openDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null;
  // Logging in needs both the osu! OAuth app and somewhere to keep sessions.
  const OAUTH_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET && db);
  const DRIVE_CONFIGURED = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  const app = new Hono<Env>();

  async function currentUser(c: Context): Promise<UserRow | undefined> {
    const sid = getCookie(c, 'sid');
    return sid && db ? db.userForSession(sid) : undefined;
  }

  // Reject cross-origin state-changing requests (cookies are SameSite=Lax as a first line of defence).
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && origin !== PUBLIC_URL && origin !== new URL(c.req.url).origin) return c.text('Cross-origin request rejected', 403);
    }
    await next();
  });

  app.onError((err, c) => {
    console.error(err);
    return c.text('Server error', 500);
  });

  // Registered after the cross-origin check above, so it applies to these routes too.
  const drive = DRIVE_CONFIGURED
    ? driveRoutes(app, { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!, publicUrl: PUBLIC_URL, secureCookies: SECURE_COOKIES })
    : null;

  // ---------------------------------------------------------------- auth

  app.get('/api/health', (c) => c.json({ ok: true, oauthConfigured: OAUTH_CONFIGURED, driveConfigured: DRIVE_CONFIGURED }));

  app.get('/api/auth/me', async (c) => {
    const u = await currentUser(c);
    return c.json({
      oauthConfigured: OAUTH_CONFIGURED,
      driveConfigured: DRIVE_CONFIGURED,
      driveConnected: drive?.connected(c) ?? false,
      user: u ? { id: u.id, username: u.username, avatarUrl: u.avatar_url, countryCode: u.country_code } : null,
    });
  });

  app.get('/api/auth/login', (c) => {
    if (!OAUTH_CONFIGURED) return c.text('osu! login is not configured on this server (OSU_CLIENT_ID / OSU_CLIENT_SECRET / SUPABASE_*).', 500);
    const state = randomBytes(16).toString('hex');
    const ret = c.req.query('return') ?? '/';
    const cookieOpts = { httpOnly: true, sameSite: 'Lax' as const, secure: SECURE_COOKIES, path: '/', maxAge: 600 };
    setCookie(c, 'oauth_state', state, cookieOpts);
    setCookie(c, 'oauth_return', ret.startsWith('/') && !ret.startsWith('//') ? ret : '/', cookieOpts);
    const url = new URL('https://osu.ppy.sh/oauth/authorize');
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify public');
    url.searchParams.set('state', state);
    return c.redirect(url.toString());
  });

  app.get('/api/auth/callback', async (c) => {
    if (!db) return c.text('Server storage is not configured.', 500);
    const code = c.req.query('code');
    const state = c.req.query('state');
    const expected = getCookie(c, 'oauth_state');
    const ret = getCookie(c, 'oauth_return') ?? '/';
    deleteCookie(c, 'oauth_state', { path: '/', secure: SECURE_COOKIES });
    deleteCookie(c, 'oauth_return', { path: '/', secure: SECURE_COOKIES });
    if (c.req.query('error')) return c.redirect(`${PUBLIC_URL}${ret}`);
    if (!code || !state || state !== expected) return c.text('Invalid OAuth state. Please try logging in again.', 400);

    const tokenRes = await fetch('https://osu.ppy.sh/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }),
    });
    if (!tokenRes.ok) return c.text(`osu! token exchange failed (${tokenRes.status}).`, 502);
    const token = (await tokenRes.json()) as { access_token: string };

    const meRes = await fetch('https://osu.ppy.sh/api/v2/me', { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
    if (!meRes.ok) return c.text(`Could not read your osu! profile (${meRes.status}).`, 502);
    const me = (await meRes.json()) as { id: number; username: string; avatar_url?: string; country_code?: string };

    await db.upsertUser({ id: me.id, username: me.username, avatar_url: me.avatar_url ?? '', country_code: me.country_code ?? '' });
    const sid = randomBytes(32).toString('hex');
    await db.createSession(sid, me.id, SESSION_TTL);
    await db.pruneSessions();
    setCookie(c, 'sid', sid, { httpOnly: true, sameSite: 'Lax', secure: SECURE_COOKIES, path: '/', maxAge: SESSION_TTL / 1000 });
    return c.redirect(`${PUBLIC_URL}${ret}`);
  });

  app.post('/api/auth/logout', async (c) => {
    const sid = getCookie(c, 'sid');
    if (sid && db) await db.deleteSession(sid);
    deleteCookie(c, 'sid', { path: '/', secure: SECURE_COOKIES });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- published beatmap info

  // An app token (client credentials, public scope) for the osu! API, shared by every request.
  let appToken: { value: string; expires: number } | null = null;
  async function osuAppToken(): Promise<string> {
    if (appToken && appToken.expires > Date.now() + 60_000) return appToken.value;
    const res = await fetch('https://osu.ppy.sh/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials', scope: 'public' }),
    });
    if (!res.ok) throw new Error(`osu! token request failed (${res.status})`);
    const t = (await res.json()) as { access_token: string; expires_in: number };
    appToken = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 };
    return t.access_token;
  }

  // A set's ranked status and its difficulties' checksums, for song select's status box. Straight from the
  // osu! API (mirrors can lag behind a pending map's updates); the browser falls back to osu.direct.
  app.get('/api/beatmapsets/:id', async (c) => {
    if (!CLIENT_ID || !CLIENT_SECRET) return c.text('osu! API access is not configured on this server.', 501);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.text('Invalid beatmapset id', 400);
    const res = await fetch(`https://osu.ppy.sh/api/v2/beatmapsets/${id}`, {
      headers: { Authorization: `Bearer ${await osuAppToken()}`, Accept: 'application/json' },
    });
    const cache = { 'Cache-Control': 'public, max-age=60' };
    if (res.status === 404) return c.json({ found: false }, 200, cache);
    if (!res.ok) return c.text(`osu! API error (${res.status})`, 502);
    const s = (await res.json()) as { status: string; beatmaps?: { id: number; checksum: string; status: string; version: string }[] };
    return c.json(
      { found: true, status: s.status, beatmaps: (s.beatmaps ?? []).map((b) => ({ id: b.id, checksum: b.checksum, status: b.status, version: b.version })) },
      200,
      cache,
    );
  });

  return app;
}
