import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';

/** Cookies from a response's Set-Cookie headers, as name → value ('' when deleted). */
function cookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = /Max-Age=0/i.test(c) ? '' : pair.slice(i + 1);
  }
  return out;
}

type Me = { user: { id: number } | null };

const ME = { id: 123, username: 'mapper', avatar_url: 'https://a.ppy.sh/123', country_code: 'FR' };

describe('osu! login', () => {
  let osu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('OSU_CLIENT_ID', 'osu-id');
    vi.stubEnv('OSU_CLIENT_SECRET', 'osu-secret');
    vi.stubEnv('PUBLIC_URL', 'https://editor.example');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    osu = vi.fn();
    vi.stubGlobal('fetch', osu);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function login() {
    const app = createApp();
    const start = await app.request('/api/auth/login?return=/songs');
    const auth = new URL(start.headers.get('location')!);
    expect(auth.origin + auth.pathname).toBe('https://osu.ppy.sh/oauth/authorize');
    const c = cookies(start);
    osu.mockResolvedValueOnce(Response.json({ access_token: 'user-token' }));
    osu.mockResolvedValueOnce(Response.json(ME));
    const cb = await app.request(`/api/auth/callback?code=the-code&state=${auth.searchParams.get('state')}`, {
      headers: { Cookie: `oauth_state=${c.oauth_state}; oauth_return=${c.oauth_return}` },
    });
    expect(cb.headers.get('location')).toBe('https://editor.example/songs');
    return { app, session: cookies(cb).osu_session };
  }

  it('keeps the session in an encrypted cookie, with no database', async () => {
    const { app, session } = await login();
    expect(session).toBeTruthy();
    expect(session).not.toContain('mapper');
    expect(session).not.toContain('user-token');
    const me = await (await app.request('/api/auth/me', { headers: { Cookie: `osu_session=${session}` } })).json();
    expect(me).toMatchObject({ oauthConfigured: true, user: { id: 123, username: 'mapper', avatarUrl: 'https://a.ppy.sh/123', countryCode: 'FR' } });
    // Another server secret can't read it.
    vi.stubEnv('OSU_CLIENT_SECRET', 'rotated');
    const other = (await (await createApp().request('/api/auth/me', { headers: { Cookie: `osu_session=${session}` } })).json()) as Me;
    expect(other.user).toBeNull();
  });

  it('rejects tampered and expired sessions, and logs out', async () => {
    const { app, session } = await login();
    const tampered = session.slice(0, -2) + (session.endsWith('AA') ? 'BB' : 'AA');
    const user = async (cookie: string) => ((await (await app.request('/api/auth/me', { headers: { Cookie: `osu_session=${cookie}` } })).json()) as Me).user;
    expect(await user(tampered)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 1000 * 60 * 60 * 24 * 366);
    expect(await user(session)).toBeNull();
    vi.useRealTimers();
    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: `osu_session=${session}` } });
    expect(cookies(out).osu_session).toBe('');
  });

  it("lists the user's own beatmapsets from every list", async () => {
    const { app, session } = await login();
    expect((await app.request('/api/me/beatmapsets')).status).toBe(401);
    osu.mockImplementation(async (url: string) => {
      if (url === 'https://osu.ppy.sh/oauth/token') return Response.json({ access_token: 'app-token', expires_in: 86400 });
      const m = /\/users\/123\/beatmapsets\/(\w+)\?limit=100&offset=(\d+)$/.exec(url);
      if (!m) return new Response('', { status: 404 });
      // 150 graveyarded sets come in two pages.
      const count = m[1] === 'graveyard' ? (m[2] === '0' ? 100 : 50) : m[1] === 'pending' ? 1 : 0;
      return Response.json(
        Array.from({ length: count }, (_, i) => ({
          id: Number(m[2]) + i + 1,
          title: `${m[1]} ${i}`,
          description: 'dropped',
          beatmaps: [{ id: 9, version: 'Insane', mode_int: 0, difficulty_rating: 5.1, total_length: 90, checksum: 'dropped' }],
        })),
      );
    });
    const res = await app.request('/api/me/beatmapsets', { headers: { Cookie: `osu_session=${session}` } });
    const sets = (await res.json()) as { id: number; kind: string; description?: string; beatmaps: Record<string, unknown>[] }[];
    expect(sets.filter((s) => s.kind === 'graveyard')).toHaveLength(150);
    expect(sets.filter((s) => s.kind === 'pending')).toHaveLength(1);
    expect(sets[0].description).toBeUndefined();
    expect(sets[0].beatmaps[0]).toEqual({ id: 9, version: 'Insane', mode_int: 0, difficulty_rating: 5.1, total_length: 90 });
    const apiCall = osu.mock.calls.find(([u]) => String(u).includes('/users/123/'))!;
    expect(apiCall[1].headers.Authorization).toBe('Bearer app-token');
  });
});
