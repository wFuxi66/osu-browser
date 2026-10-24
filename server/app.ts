// The API as a plain Hono app: osu! OAuth login, sessions, and per-account beatmap project storage.
// Shared by the Vercel function (api/index.ts) and the standalone Node server (server/index.ts).
// .osz packages never pass through here: the browser uploads/downloads them directly to Supabase Storage
// with short-lived signed URLs this API issues after checking ownership and quota (Vercel functions cap
// request bodies at ~4.5 MB).
import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { openDb, type Db, type UserRow } from './db.ts';

const SESSION_TTL = 1000 * 60 * 60 * 24 * 365;
/** Signed upload URLs from Supabase are valid for 2 hours. */
const UPLOAD_TTL = 1000 * 60 * 60 * 2;
const MAX_PENDING_UPLOADS = 4;
const MB = 1024 * 1024;

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;
const VALID_UPLOAD_ID = /^[0-9a-f]{24}$/;

export type Env = { Variables: { user: UserRow } };

export function createApp() {
  const env = process.env;
  const CLIENT_ID = env.OSU_CLIENT_ID ?? '';
  const CLIENT_SECRET = env.OSU_CLIENT_SECRET ?? '';
  const PUBLIC_URL = (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const REDIRECT_URI = env.OSU_REDIRECT_URI ?? `${PUBLIC_URL}/api/auth/callback`;
  // 50 MB is the Supabase Free plan's per-file limit (also set on the bucket in the migration).
  const MAX_PROJECT_BYTES = Number(env.MAX_PROJECT_BYTES) || 50 * MB;
  // The Free plan has 1 GB of storage in total. Published sets sync as a few KB (the browser re-downloads
  // their audio and images from the mirrors), so the quota mostly holds original maps (~5-15 MB each).
  const MAX_USER_BYTES = Number(env.MAX_USER_BYTES) || 150 * MB;
  const SECURE_COOKIES = PUBLIC_URL.startsWith('https://');
  const db: Db | null = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? openDb(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null;
  // Logging in needs both the osu! OAuth app and somewhere to keep sessions.
  const OAUTH_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET && db);

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

  // ---------------------------------------------------------------- auth

  app.get('/api/health', (c) => c.json({ ok: true, oauthConfigured: OAUTH_CONFIGURED }));

  app.get('/api/auth/me', async (c) => {
    const u = await currentUser(c);
    return c.json({
      oauthConfigured: OAUTH_CONFIGURED,
      maxProjectBytes: MAX_PROJECT_BYTES,
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

  // ---------------------------------------------------------------- projects (require login)

  const requireUser = async (c: Context<Env>, next: () => Promise<void>) => {
    const u = await currentUser(c);
    if (!u) return c.text('Not logged in', 401);
    c.set('user', u);
    await next();
  };

  app.use('/api/projects', requireUser);
  app.use('/api/projects/*', requireUser);

  const tooLarge = (size: number) =>
    `This map's .osz is ${(size / MB).toFixed(1)} MB, over the ${Math.round(MAX_PROJECT_BYTES / MB)} MB cloud sync limit ` +
    `(the Supabase Free plan's maximum file size). It's still saved in this browser; use File → Export package (.osz) to keep a copy.`;

  app.get('/api/projects', async (c) => {
    const u = c.get('user');
    const rows = await db!.listProjects(u.id);
    return c.json(rows.map((p) => ({ id: p.id, title: p.title, createdAt: p.created_at, updatedAt: p.updated_at, size: p.size })));
  });

  // Download: a short-lived signed URL for the caller's own package.
  app.get('/api/projects/:id', async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const p = VALID_ID.test(id) ? await db!.getProject(u.id, id) : undefined;
    if (!p) return c.text('Not found', 404);
    return c.json({ url: await db!.signedDownloadUrl(p.object_path) }, 200, { 'Cache-Control': 'no-store' });
  });

  // Upload step 1: reserve quota and get a signed URL to PUT the .osz to.
  app.post('/api/projects/:id/upload', async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    if (!VALID_ID.test(id)) return c.text('Invalid project id', 400);
    const { size } = await c.req.json<{ size?: unknown }>().catch(() => ({ size: undefined }));
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return c.text('Missing package size', 400);
    if (size > MAX_PROJECT_BYTES) return c.text(tooLarge(size), 413);

    // Drop expired reservations (and anything uploaded to them but never committed).
    const now = Date.now();
    const pending = await db!.listPending(u.id);
    const expired = pending.filter((p) => Date.parse(p.expires_at) <= now).map((p) => p.object_path);
    await db!.removeObjects(expired);
    await db!.deletePending(expired);
    const active = pending.filter((p) => Date.parse(p.expires_at) > now);
    if (active.length >= MAX_PENDING_UPLOADS) return c.text('Too many uploads in progress; try again in a few minutes.', 429);

    const projects = await db!.listProjects(u.id);
    const used = projects.reduce((s, p) => s + (p.id === id ? 0 : p.size), 0) + active.reduce((s, p) => s + p.size, 0);
    if (used + size > MAX_USER_BYTES) return c.text(`Cloud storage quota exceeded (${Math.round(MAX_USER_BYTES / MB)} MB per account). Delete some synced maps first.`, 413);

    const uploadId = randomBytes(12).toString('hex');
    const path = `${u.id}/${id}/${uploadId}.osz`;
    await db!.addPending(u.id, { object_path: path, project_id: id, size, expires_at: new Date(now + UPLOAD_TTL).toISOString() });
    return c.json({ uploadId, uploadUrl: await db!.signedUploadUrl(path) });
  });

  // Upload step 2: verify what landed in storage, then point the project at it.
  app.post('/api/projects/:id/commit', async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json<{ uploadId?: unknown; title?: unknown; createdAt?: unknown; updatedAt?: unknown }>().catch(() => null);
    if (!VALID_ID.test(id) || !body || typeof body.uploadId !== 'string' || !VALID_UPLOAD_ID.test(body.uploadId)) return c.text('Invalid request', 400);
    const path = `${u.id}/${id}/${body.uploadId}.osz`;
    const reservation = (await db!.listPending(u.id)).find((p) => p.object_path === path);
    if (!reservation) return c.text('Upload expired or unknown; please sync again.', 409);

    const reject = async (status: 400 | 413, msg: string) => {
      await db!.removeObjects([path]);
      await db!.deletePending([path]);
      return c.text(msg, status);
    };
    const obj = await db!.inspectObject(path);
    if (!obj) return c.text('Upload not found in storage', 409);
    if (obj.size > reservation.size || obj.size > MAX_PROJECT_BYTES) return reject(413, tooLarge(obj.size));
    // .osz files are zip archives.
    if (obj.head.length < 4 || new DataView(obj.head.buffer).getUint32(0, true) !== 0x04034b50) return reject(400, 'Upload is not an .osz (zip) file');

    const existing = await db!.getProject(u.id, id);
    const updatedAt = typeof body.updatedAt === 'number' && body.updatedAt > 0 ? body.updatedAt : Date.now();
    const createdAt = existing?.created_at ?? (typeof body.createdAt === 'number' && body.createdAt > 0 ? body.createdAt : updatedAt);
    const title = (typeof body.title === 'string' ? body.title : 'Untitled').slice(0, 300);
    await db!.putProject(u.id, { id, title, created_at: createdAt, updated_at: updatedAt, size: obj.size, object_path: path });
    await db!.deletePending([path]);
    if (existing && existing.object_path !== path) await db!.removeObjects([existing.object_path]);
    return c.json({ ok: true, updatedAt });
  });

  app.delete('/api/projects/:id', async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    if (!VALID_ID.test(id)) return c.text('Invalid project id', 400);
    const p = await db!.getProject(u.id, id);
    if (p) {
      await db!.deleteProject(u.id, id);
      await db!.removeObjects([p.object_path]);
    }
    return c.json({ ok: true });
  });

  return app;
}
