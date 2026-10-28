import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './app.ts';
import { MAX_DOWNLOADS, mirrorRoutes } from './mirror.ts';

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

/** A response whose body arrives in the given chunks; `hold` keeps it open after them until released. */
function streamed(chunks: Uint8Array[], hold?: Promise<void>) {
  return new Response(
    new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) ctrl.enqueue(c);
        await hold;
        ctrl.close();
      },
    }),
  );
}

describe('beatmap mirror proxy', () => {
  let mirrors: ReturnType<typeof vi.fn>;
  let app: Hono<Env>;

  beforeEach(() => {
    mirrors = vi.fn();
    vi.stubGlobal('fetch', mirrors);
    app = new Hono<Env>();
    mirrorRoutes(app);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('streams a set through, the zip signature split across chunks', async () => {
    mirrors.mockResolvedValueOnce(streamed([ZIP.slice(0, 2), ZIP.slice(2)]));
    const res = await app.request('/api/mirror/1');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ZIP);
  });

  it('skips a mirror that answers with something other than a zip', async () => {
    mirrors.mockResolvedValueOnce(new Response('<html>rate limited</html>')).mockResolvedValueOnce(streamed([ZIP]));
    const res = await app.request('/api/mirror/1');
    expect(res.status).toBe(200);
    expect(mirrors).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(ZIP);
  });

  it('rejects ids that are not positive integers without fetching', async () => {
    for (const id of ['0', '-1', '1.5', 'abc']) expect((await app.request(`/api/mirror/${id}`)).status).toBe(400);
    expect(mirrors).not.toHaveBeenCalled();
  });

  it('caps the downloads in flight, and frees a slot when one finishes', async () => {
    let finish!: () => void;
    const hold = new Promise<void>((r) => (finish = r));
    mirrors.mockImplementation(async () => streamed([ZIP], hold));
    const open = await Promise.all(Array.from({ length: MAX_DOWNLOADS }, () => app.request('/api/mirror/1')));
    expect(open.every((r) => r.status === 200)).toBe(true);
    expect((await app.request('/api/mirror/1')).status).toBe(503);

    finish();
    await Promise.all(open.map((r) => r.arrayBuffer()));
    expect((await app.request('/api/mirror/1')).status).toBe(200);
  });

  it('frees the slot when every mirror fails', async () => {
    mirrors.mockRejectedValue(new Error('down'));
    for (let i = 0; i <= MAX_DOWNLOADS; i++) expect((await app.request('/api/mirror/1')).status).toBe(502);
  });
});
