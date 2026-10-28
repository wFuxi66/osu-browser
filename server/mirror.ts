// The beatmap mirror proxy of the standalone server. The browser downloads published maps straight from mirrors
// that send CORS headers; this is only a fallback for when those fail (not deployed on Vercel). Only fixed mirror
// URLs with a numeric id are requested. Sets are streamed through rather than held in memory, and only a few
// download at once, so anyone hitting the proxy can't run the server out of memory.
import type { Hono } from 'hono';
import type { Env } from './app.ts';

const MIRRORS = [
  (id: number) => `https://catboy.best/d/${id}`,
  (id: number) => `https://api.nerinyan.moe/d/${id}`,
  (id: number) => `https://osu.direct/api/d/${id}`,
];
const ZIP_MAGIC = 0x04034b50;
const TIMEOUT_MS = 30_000;
export const MAX_DOWNLOADS = 4;

export function mirrorRoutes(app: Hono<Env>) {
  let downloads = 0;

  app.get('/api/mirror/:setId', async (c) => {
    const id = Number(c.req.param('setId'));
    if (!Number.isInteger(id) || id <= 0) return c.text('Invalid beatmapset id', 400);
    if (downloads >= MAX_DOWNLOADS) return c.text('The server is busy with other downloads. Try again in a moment.', 503);
    downloads++;
    let released = false;
    const release = () => {
      if (!released) downloads--;
      released = true;
    };
    for (const mirror of MIRRORS) {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      try {
        const res = await fetch(mirror(id), { redirect: 'follow', signal });
        if (!res.ok || !res.body) continue;
        const body = await zipStream(res.body, release);
        if (!body) continue;
        // Past the timeout the download is aborted, so its slot is free even if the client stopped reading.
        signal.addEventListener('abort', release);
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
        const length = res.headers.get('content-length');
        // fetch undoes a content encoding, which leaves the length wrong.
        if (length && !res.headers.get('content-encoding')) headers['Content-Length'] = length;
        return c.body(body, 200, headers);
      } catch {
        // try the next mirror
      }
    }
    release();
    return c.text('Could not download that beatmapset from any mirror.', 502);
  });
}

/** The body passed through as it arrives, or null when it doesn't start like a zip. `done` runs when it ends, however it ends. */
async function zipStream(body: ReadableStream<Uint8Array>, done: () => void): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  let head = new Uint8Array(0);
  while (head.length < 4) {
    const { value, done: end } = await reader.read();
    if (end) break;
    head = Buffer.concat([head, value]);
  }
  if (head.length < 4 || Buffer.from(head.buffer, head.byteOffset, 4).readUInt32LE(0) !== ZIP_MAGIC) {
    void reader.cancel().catch(() => {});
    return null;
  }
  return new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(head);
    },
    async pull(ctrl) {
      try {
        const { value, done: end } = await reader.read();
        if (end) {
          ctrl.close();
          done();
        } else ctrl.enqueue(value);
      } catch (e) {
        ctrl.error(e);
        done();
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    },
  });
}
