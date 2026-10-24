import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

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

describe('Google Drive sign-in', () => {
  let google: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('PUBLIC_URL', 'https://editor.example');
    google = vi.fn();
    vi.stubGlobal('fetch', google);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function connect(grantedScope = SCOPE) {
    const app = createApp();
    const login = await app.request('/api/drive/login?return=/songs');
    expect(login.status).toBe(302);
    const auth = new URL(login.headers.get('location')!);
    expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(auth.searchParams.get('scope')).toBe(SCOPE);
    expect(auth.searchParams.get('access_type')).toBe('offline');
    expect(auth.searchParams.get('redirect_uri')).toBe('https://editor.example/api/drive/callback');
    const c = cookies(login);
    google.mockResolvedValueOnce(Response.json({ access_token: 'a1', refresh_token: 'refresh-123', scope: grantedScope, expires_in: 3599 }));
    const cb = await app.request(`/api/drive/callback?code=the-code&state=${auth.searchParams.get('state')}`, {
      headers: { Cookie: `drive_state=${c.drive_state}; drive_return=${c.drive_return}` },
    });
    return { app, cb };
  }

  it('keeps the refresh token in an encrypted cookie and hands out access tokens', async () => {
    const { app, cb } = await connect();
    expect(cb.headers.get('location')).toBe('https://editor.example/songs?drive=connected');
    const [url, init] = google.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String(init.body)).toContain('code=the-code');
    const sealed = cookies(cb).gdrive;
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain('refresh-123');

    const me = await (await app.request('/api/auth/me', { headers: { Cookie: `gdrive=${sealed}` } })).json();
    expect(me).toMatchObject({ driveConfigured: true, driveConnected: true });

    google.mockResolvedValueOnce(Response.json({ access_token: 'fresh-token', expires_in: 3599 }));
    const tok = await app.request('/api/drive/token', { method: 'POST', headers: { Cookie: `gdrive=${sealed}` } });
    expect(await tok.json()).toEqual({ accessToken: 'fresh-token', expiresIn: 3599 });
    expect(String(google.mock.calls[1][1].body)).toContain('refresh_token=refresh-123');
  });

  it("doesn't connect when the Drive permission was unticked", async () => {
    const { cb } = await connect('openid');
    expect(cb.headers.get('location')).toBe('https://editor.example/songs?drive=noscope');
    expect(cookies(cb).gdrive).toBeUndefined();
  });

  it('rejects missing, tampered and revoked tokens, and cross-origin requests', async () => {
    const { app, cb } = await connect();
    const sealed = cookies(cb).gdrive;
    expect((await app.request('/api/drive/token', { method: 'POST' })).status).toBe(401);
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
    expect((await app.request('/api/drive/token', { method: 'POST', headers: { Cookie: `gdrive=${tampered}` } })).status).toBe(401);
    const evil = await app.request('/api/drive/token', { method: 'POST', headers: { Cookie: `gdrive=${sealed}`, Origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);

    google.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    const revoked = await app.request('/api/drive/token', { method: 'POST', headers: { Cookie: `gdrive=${sealed}` } });
    expect(revoked.status).toBe(401);
    expect(cookies(revoked).gdrive).toBe('');
  });

  it('revokes the token on disconnect', async () => {
    const { app, cb } = await connect();
    google.mockResolvedValueOnce(new Response(''));
    const out = await app.request('/api/drive/logout', { method: 'POST', headers: { Cookie: `gdrive=${cookies(cb).gdrive}` } });
    expect(cookies(out).gdrive).toBe('');
    const [url, init] = google.mock.calls.at(-1)!;
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(String(init.body)).toBe('token=refresh-123');
  });
});
