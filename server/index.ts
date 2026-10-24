// Backend: osu! OAuth login, per-account beatmap project storage, and a beatmap mirror proxy.
// Run with `node server/index.ts` (Node 22.18+ strips the TypeScript types natively).
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { openDb, type UserRow } from './db.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_ID = process.env.OSU_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.OSU_CLIENT_SECRET ?? '';
const PUBLIC_URL = (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const REDIRECT_URI = process.env.OSU_REDIRECT_URI ?? `${PUBLIC_URL}/api/auth/callback`;
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');
const SESSION_TTL = 1000 * 60 * 60 * 24 * 365;
const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
const MAX_USER_BYTES = 2 * 1024 * 1024 * 1024;
const SECURE_COOKIES = PUBLIC_URL.startsWith('https://');
const OAUTH_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET);

const db = openDb(DATA_DIR);
db.pruneSessions();

type Env = { Variables: { user: UserRow } };
const app = new Hono<Env>();

function currentUser(c: Context): UserRow | undefined {
  const sid = getCookie(c, 'sid');
  return sid ? db.userForSession(sid) : undefined;
}

function projectPath(userId: number, id: string) {
  return join(DATA_DIR, 'projects', String(userId), `${id}.osz`);
}

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

// Reject cross-origin state-changing requests (cookies are SameSite=Lax as a first line of defence).
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== PUBLIC_URL && origin !== new URL(c.req.url).origin) return c.text('Cross-origin request rejected', 403);
  }
  await next();
});

// ------------------------------------------------------------------ auth

app.get('/api/health', (c) => c.json({ ok: true, oauthConfigured: OAUTH_CONFIGURED }));

app.get('/api/auth/me', (c) => {
  const u = currentUser(c);
  return c.json({
    oauthConfigured: OAUTH_CONFIGURED,
    user: u ? { id: u.id, username: u.username, avatarUrl: u.avatar_url, countryCode: u.country_code } : null,
  });
});

app.get('/api/auth/login', (c) => {
  if (!OAUTH_CONFIGURED) return c.text('osu! OAuth is not configured on this server (OSU_CLIENT_ID / OSU_CLIENT_SECRET).', 500);
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
  const code = c.req.query('code');
  const state = c.req.query('state');
  const expected = getCookie(c, 'oauth_state');
  const ret = getCookie(c, 'oauth_return') ?? '/';
  deleteCookie(c, 'oauth_state', { path: '/' });
  deleteCookie(c, 'oauth_return', { path: '/' });
  if (c.req.query('error')) return c.redirect(`${PUBLIC_URL}${ret}`);
  if (!code || !state || state !== expected) return c.text('Invalid OAuth state. Please try logging in again.', 400);

  const tokenRes = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI }),
  });
  if (!tokenRes.ok) return c.text(`osu! token exchange failed (${tokenRes.status}).`, 502);
  const token = (await tokenRes.json()) as { access_token: string; refresh_token?: string };

  const meRes = await fetch('https://osu.ppy.sh/api/v2/me', { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
  if (!meRes.ok) return c.text(`Could not read your osu! profile (${meRes.status}).`, 502);
  const me = (await meRes.json()) as { id: number; username: string; avatar_url?: string; country_code?: string };

  db.upsertUser({ id: me.id, username: me.username, avatar_url: me.avatar_url ?? '', country_code: me.country_code ?? '' }, token.refresh_token ?? null);
  const sid = randomBytes(32).toString('hex');
  db.createSession(sid, me.id, SESSION_TTL);
  setCookie(c, 'sid', sid, { httpOnly: true, sameSite: 'Lax', secure: SECURE_COOKIES, path: '/', maxAge: SESSION_TTL / 1000 });
  return c.redirect(`${PUBLIC_URL}${ret}`);
});

app.post('/api/auth/logout', (c) => {
  const sid = getCookie(c, 'sid');
  if (sid) db.deleteSession(sid);
  deleteCookie(c, 'sid', { path: '/' });
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ projects (require login)

const requireUser = async (c: Context<Env>, next: () => Promise<void>) => {
  const u = currentUser(c);
  if (!u) return c.text('Not logged in', 401);
  c.set('user', u);
  await next();
};

app.use('/api/projects', requireUser);
app.use('/api/projects/*', requireUser);

app.get('/api/projects', (c) => {
  const u = c.get('user');
  return c.json(db.listProjects(u.id).map((p) => ({ id: p.id, title: p.title, createdAt: p.created_at, updatedAt: p.updated_at, size: p.size })));
});

app.get('/api/projects/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  if (!VALID_ID.test(id) || !db.getProject(u.id, id)) return c.text('Not found', 404);
  const data = await readFile(projectPath(u.id, id)).catch(() => null);
  if (!data) return c.text('Not found', 404);
  return c.body(data, 200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
});

app.put('/api/projects/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  if (!VALID_ID.test(id)) return c.text('Invalid project id', 400);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_PROJECT_BYTES) return c.text('Beatmap package is too large', 413);
  const body = Buffer.from(await c.req.arrayBuffer());
  if (body.length > MAX_PROJECT_BYTES) return c.text('Beatmap package is too large', 413);
  // .osz files are zip archives.
  if (body.length < 4 || body.readUInt32LE(0) !== 0x04034b50) return c.text('Body is not an .osz (zip) file', 400);
  const existing = db.getProject(u.id, id);
  if (db.totalSize(u.id) - (existing?.size ?? 0) + body.length > MAX_USER_BYTES) return c.text('Storage quota exceeded', 413);
  const title = decodeURIComponent(c.req.header('x-title') ?? 'Untitled').slice(0, 300);
  const updatedAt = Number(c.req.header('x-updated-at')) || Date.now();
  const createdAt = Number(c.req.header('x-created-at')) || updatedAt;
  await mkdir(join(DATA_DIR, 'projects', String(u.id)), { recursive: true });
  await writeFile(projectPath(u.id, id), body);
  db.putProject(u.id, { id, title, created_at: existing?.created_at ?? createdAt, updated_at: updatedAt, size: body.length });
  return c.json({ ok: true, updatedAt });
});

app.delete('/api/projects/:id', async (c) => {
  const u = c.get('user');
  const id = c.req.param('id');
  if (!VALID_ID.test(id)) return c.text('Invalid project id', 400);
  db.deleteProject(u.id, id);
  await rm(projectPath(u.id, id), { force: true });
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ beatmap mirror proxy

// osu!'s API doesn't allow downloading beatmapsets with third-party OAuth, so published maps are fetched
// from public mirrors. Only fixed mirror URLs with a numeric id are requested.
const MIRRORS = [
  (id: number) => `https://catboy.best/d/${id}`,
  (id: number) => `https://api.nerinyan.moe/d/${id}`,
  (id: number) => `https://osu.direct/api/d/${id}`,
];

app.get('/api/mirror/:setId', async (c) => {
  const id = Number(c.req.param('setId'));
  if (!Number.isInteger(id) || id <= 0) return c.text('Invalid beatmapset id', 400);
  for (const mirror of MIRRORS) {
    try {
      const res = await fetch(mirror(id), { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) continue;
      return c.body(data, 200, { 'Content-Type': 'application/octet-stream' });
    } catch {
      // try the next mirror
    }
  }
  return c.text('Could not download that beatmapset from any mirror.', 502);
});

// ------------------------------------------------------------------ static frontend (production)

if (existsSync('./dist/index.html')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`osu! web editor server on http://localhost:${info.port} (OAuth ${OAUTH_CONFIGURED ? 'configured' : 'NOT configured'})`);
});
