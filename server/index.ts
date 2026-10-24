// Standalone Node server (Docker / `npm start` / `npm run dev`): the API from app.ts, a beatmap mirror
// proxy fallback, and the built frontend. Run with `node server/index.ts` (Node 22.18+ strips types natively).
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT ?? 8787);
const app = createApp();

// ------------------------------------------------------------------ beatmap mirror proxy

// The browser downloads published maps straight from mirrors that send CORS headers; this proxy is only a
// fallback for when those fail (not deployed on Vercel). Only fixed mirror URLs with a numeric id are requested.
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
  const oauth = Boolean(process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET);
  console.log(`osu-browser server on http://localhost:${info.port} (login ${oauth ? 'configured' : 'NOT configured'})`);
});
