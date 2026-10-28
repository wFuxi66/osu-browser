// Standalone Node server (Docker / `npm start` / `npm run dev`): the API from app.ts, a beatmap mirror
// proxy fallback, and the built frontend. Run with `node server/index.ts` (Node 22.18+ strips types natively).
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { HSTS, SECURITY_HEADERS } from './headers.ts';
import { mirrorRoutes } from './mirror.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file; rely on the real environment.
}

const PORT = Number(process.env.PORT ?? 8787);
const headers = { ...SECURITY_HEADERS, ...(process.env.PUBLIC_URL?.startsWith('https://') ? { 'Strict-Transport-Security': HSTS } : {}) };
const app = createApp();

mirrorRoutes(app);

// ------------------------------------------------------------------ static frontend (production)

if (existsSync('./dist/index.html')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve(
  {
    // On every response, whichever route made it (the routes return before any later middleware would run).
    fetch: async (req, env) => {
      const res = await app.fetch(req, env);
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
      return out;
    },
    port: PORT,
  },
  (info) => {
    const oauth = Boolean(process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET);
    console.log(`osu!browser server on http://localhost:${info.port} (login ${oauth ? 'configured' : 'NOT configured'})`);
  },
);
