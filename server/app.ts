// The API as a plain Hono app: osu! OAuth login, osu! API lookups, and Google Drive sign-in for cloud sync.
// Shared by the Vercel function (api/index.ts) and the standalone Node server (server/index.ts).
// There's no database: the osu! session and the Drive refresh token live in encrypted httpOnly cookies, and
// beatmaps never pass through here (the browser syncs them straight to the user's own Google Drive, drive.ts).
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { driveRoutes } from './drive.ts';
import { sealer } from './seal.ts';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 365;
const SESSION_COOKIE = 'osu_session';

export type Env = { Variables: Record<string, never> };

export interface OsuUser {
  id: number;
  username: string;
  avatarUrl: string;
  countryCode: string;
}

/** The lists of a user's sets that "My beatmaps" shows, in the osu! API's words (pending includes WIP). */
const MY_SET_KINDS = ['pending', 'ranked', 'loved', 'guest', 'graveyard'] as const;
const MY_SETS_PER_KIND = 500;

export function createApp() {
  const env = process.env;
  const CLIENT_ID = env.OSU_CLIENT_ID ?? '';
  const CLIENT_SECRET = env.OSU_CLIENT_SECRET ?? '';
  const PUBLIC_URL = (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const REDIRECT_URI = env.OSU_REDIRECT_URI ?? `${PUBLIC_URL}/api/auth/callback`;
  const SECURE_COOKIES = PUBLIC_URL.startsWith('https://');
  const OAUTH_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET);
  const DRIVE_CONFIGURED = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  // The session cookie's key is derived from the osu! client secret: rotating it signs everyone out.
  const session = sealer(CLIENT_SECRET, 'osu-session');

  const app = new Hono<Env>();

  function currentUser(c: Context): OsuUser | null {
    const v = getCookie(c, SESSION_COOKIE);
    const text = v && OAUTH_CONFIGURED ? session.open(v) : null;
    if (!text) return null;
    try {
      const s = JSON.parse(text) as { user: OsuUser; exp: number };
      return s.exp > Date.now() ? s.user : null;
    } catch {
      return null;
    }
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

  app.get('/api/auth/me', (c) =>
    c.json({
      oauthConfigured: OAUTH_CONFIGURED,
      driveConfigured: DRIVE_CONFIGURED,
      driveConnected: drive?.connected(c) ?? false,
      user: currentUser(c),
    }),
  );

  app.get('/api/auth/login', (c) => {
    if (!OAUTH_CONFIGURED) return c.text('osu! login is not configured on this server (OSU_CLIENT_ID / OSU_CLIENT_SECRET).', 500);
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
    if (!OAUTH_CONFIGURED) return c.text('osu! login is not configured on this server.', 500);
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

    // Only who the user is goes in the session; their osu! token is dropped (the API calls below use the app's own).
    const user: OsuUser = { id: me.id, username: me.username, avatarUrl: me.avatar_url ?? '', countryCode: me.country_code ?? '' };
    setCookie(c, SESSION_COOKIE, session.seal(JSON.stringify({ user, exp: Date.now() + SESSION_TTL })), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: SECURE_COOKIES,
      path: '/',
      maxAge: SESSION_TTL / 1000,
    });
    return c.redirect(`${PUBLIC_URL}${ret}`);
  });

  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: SECURE_COOKIES });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- osu! API

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

  const osuApi = async (path: string) =>
    fetch(`https://osu.ppy.sh/api/v2${path}`, { headers: { Authorization: `Bearer ${await osuAppToken()}`, Accept: 'application/json' } });

  // A set's ranked status and its difficulties' checksums, for song select's status box. Straight from the
  // osu! API (mirrors can lag behind a pending map's updates); the browser falls back to osu.direct.
  app.get('/api/beatmapsets/:id', async (c) => {
    if (!OAUTH_CONFIGURED) return c.text('osu! API access is not configured on this server.', 501);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.text('Invalid beatmapset id', 400);
    const res = await osuApi(`/beatmapsets/${id}`);
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

  // The logged-in user's uploaded sets (and the sets they made guest difficulties for), for "My beatmaps" in
  // the osu!direct panel. Same shape as osu.direct's search results, plus which list each set came from.
  app.get('/api/me/beatmapsets', async (c) => {
    const user = currentUser(c);
    if (!user) return c.text('Log in with osu! to see your beatmaps.', 401);
    const lists = await Promise.all(
      MY_SET_KINDS.map(async (kind) => {
        const sets: Record<string, unknown>[] = [];
        while (sets.length < MY_SETS_PER_KIND) {
          const res = await osuApi(`/users/${user.id}/beatmapsets/${kind}?limit=100&offset=${sets.length}`);
          if (!res.ok) throw new Error(`osu! API error (${res.status}) listing ${kind} beatmaps`);
          const page = (await res.json()) as Record<string, unknown>[];
          sets.push(...page);
          if (page.length < 100) break;
        }
        return sets.map((s) => ({ ...pickSet(s), kind }));
      }),
    );
    return c.json(lists.flat(), 200, { 'Cache-Control': 'private, no-store' });
  });

  return app;
}

/** The fields of an osu! API beatmapset that the browser shows (it parses them like osu.direct's search results). */
function pickSet(s: Record<string, unknown>) {
  const keep = ['id', 'artist', 'title', 'creator', 'status', 'bpm', 'play_count', 'favourite_count', 'video', 'storyboard', 'covers', 'preview_url', 'last_updated', 'ranked_date', 'legacy_thread_url'];
  const out: Record<string, unknown> = Object.fromEntries(keep.map((k) => [k, s[k]]));
  out.beatmaps = ((s.beatmaps as Record<string, unknown>[] | undefined) ?? []).map((b) => ({
    id: b.id,
    version: b.version,
    mode_int: b.mode_int,
    difficulty_rating: b.difficulty_rating,
    total_length: b.total_length,
  }));
  return out;
}
