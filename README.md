# osu! web editor

An osu! (stable) style beatmap editor that runs in any modern browser. Drop an mp3 to start a new map, or open an `.osz` / beatmap folder to keep editing. When you're done, export the `.osz` (or a single `.osu`) and open it in osu!. Uploading to the osu! website isn't supported; use the real client for that.

Your work autosaves in the browser (IndexedDB). If you log in with your osu! account (optional), your WIP maps also sync to the cloud, so they're there when you open the editor on another computer.

## Architecture

- **Frontend** (`src/`): Vite + React + TypeScript, built to static files. Everything editor-related runs in the browser; projects autosave to IndexedDB.
- **API** (`server/app.ts`): a small Hono app for osu! OAuth, sessions, and the cloud project list. It runs as a Vercel Function (`api/index.ts`) or as a plain Node server (`server/index.ts`, used by `npm run dev` and Docker).
- **Database**: Supabase Postgres (`users`, `sessions`, `projects`, `pending_uploads`). The schema is in `supabase/migrations/`. Only the server touches it, with the service role key; RLS is on and the public roles have no grants.
- **Storage**: `.osz` packages live in the private Supabase Storage bucket `projects`. The browser uploads and downloads them directly with short-lived signed URLs from the API, because Vercel Functions cap request bodies at about 4.5 MB. The API checks ownership, the per-map size limit (50 MB, the Supabase Free plan's maximum file size), and the per-account quota (500 MB by default). It also verifies each upload (size, zip header) before pointing the project at it.

## Running locally

Requires Node.js 22.18+ (Node 24 recommended).

```sh
npm install
cp .env.example .env     # optional: only needed for osu! login / cloud sync (osu! OAuth + Supabase)
npm run dev              # web on http://localhost:5173, API on :8787
```

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build` then `npm start` (serves the built app + API on one port).

### Enabling "Log in with osu!"

1. Sign in on osu.ppy.sh and open <https://osu.ppy.sh/home/account/edit#oauth>, then click **New OAuth Application**.
2. Name it (e.g. "osu! web editor"). For **Application Callback URL**, use `http://localhost:5173/api/auth/callback` for local development, or `https://your-domain/api/auth/callback` in production. It must match `OSU_REDIRECT_URI` exactly. You can register both: create a second application for production.
3. Copy the **Client ID** and **Client Secret** into `.env` (`OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`). In production also set `PUBLIC_URL=https://your-domain` and `OSU_REDIRECT_URI=https://your-domain/api/auth/callback`.
4. Login also needs a Supabase project for sessions and storage (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; see below).

osu!'s OAuth needs a client secret for the token exchange, which is why there's a small backend. Supabase Auth has no osu! provider, so the flow is our own and sessions are an httpOnly cookie backed by the `sessions` table. The editor only asks for the `identify public` scopes (username and avatar). Without OAuth configured, the editor still works fully offline/local.

### Deploying

**Supabase (database + storage)**, needed by both deployment options below:

```sh
npx supabase login
npx supabase projects create osumappingweb --org-id <org> --region eu-central-1 --db-password <password>
npx supabase link --project-ref <ref>
npx supabase db push --linked      # creates the tables and the private "projects" bucket (50 MB file limit)
npx supabase projects api-keys --project-ref <ref>   # copy the service_role key
```

`SUPABASE_URL` is `https://<ref>.supabase.co`. Keep the service role key server-side only: it goes in the Vercel/server environment and never in client code or the repo. The 50 MB limit per map is the Free plan's maximum file size. On a paid plan, raise the bucket's `file_size_limit` and `MAX_PROJECT_BYTES` together. Uploads that went over the limit or were never committed are cleaned up the next time that account uploads.

**Vercel (recommended, no server needed):**

`vercel.json` builds the Vite app as static files, rewrites `/api/*` to the Hono function in `api/index.ts`, rewrites every other path to `index.html`, and pins the function to `fra1` (next to the eu-central-1 database; change both together if you move regions).

```sh
npx vercel link
npx vercel env add OSU_CLIENT_ID production          # repeat for each variable below
npx vercel deploy --prod
```

Environment variables: `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`, `PUBLIC_URL` (e.g. `https://your-app.vercel.app`), `OSU_REDIRECT_URI` (`$PUBLIC_URL/api/auth/callback`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Check it with `curl https://your-app.vercel.app/api/health`. `.vercelignore` keeps your local `.env` out of CLI uploads.

**Docker Compose with automatic HTTPS (any VPS):**

1. Point a domain (A/AAAA record) at the server, and open ports 80 and 443.
2. On the server: `git clone` this repo, then `cp .env.example .env` and fill in the production values above, including `SUPABASE_*`.
3. `DOMAIN=editor.example.com docker compose up -d --build`

Caddy obtains the TLS certificate and proxies to the app. Check it with `curl https://editor.example.com/api/health`. To update: `git pull && DOMAIN=… docker compose up -d --build`.

**Plain Docker (behind your own proxy, or on Fly.io/Railway/Render):**

`docker build -t osu-web-editor . && docker run -d -p 8787:8787 --env-file .env osu-web-editor`

The container is stateless (all data is in Supabase), listens on `PORT` (8787), and exposes `/api/health` for health checks.

### Opening published maps

The home screen accepts an `osu.ppy.sh/beatmapsets/…` link. The official API doesn't let third-party apps download beatmapsets, so the browser downloads them directly from public mirrors that allow CORS: osu.direct first, then nerinyan. When the app runs on the Node server, it also falls back to a server-side proxy that adds catboy.best. That proxy isn't deployed on Vercel.

## Feature checklist (vs. the stable editor)

**Files & projects**
- [x] New beatmap from mp3/ogg (reads ID3 artist/title/cover art)
- [x] Open `.osz`, a dropped beatmap folder, or loose `.osu` + assets
- [x] Open published maps by link (direct from CORS-enabled mirrors)
- [x] Save (Ctrl+S), autosave, revert to saved (Ctrl+L)
- [x] Export `.osz` package and single `.osu`
- [x] Multiple difficulties: create (copy timing / copy objects / any mode), switch (Ctrl+O), delete
- [x] Add files to the beatmap folder (custom hitsounds, images, storyboard assets), replace audio
- [x] Lossless round trip of `.osu` files (verified against ranked maps)
- [x] osu! OAuth login + per-account cloud sync

**Compose (F1)**
- [x] Select / circle / slider / spinner tools (1–4), mania note/hold tools
- [x] Slider placement with auto curve type (linear → perfect circle → bézier), red anchors, preview and length snapped to beat divisor, right-click/Enter to finish (controls checked against the osu! wiki)
- [x] Spinners placed like stable: click to start at the current time, seek forward, click again to end
- [x] Slider control point editing: drag, Ctrl+click to toggle red anchor / insert point, right-click to delete
- [x] Slider repeats by dragging the tail in the timeline
- [x] Grid snap (T, Shift to toggle temporarily), grid sizes (G, Ctrl+1–4), distance snap (Y, Alt temporarily) with distance spacing (Alt+wheel)
- [x] Approach circles, follow points, combo numbers & colours (stable colour indexing), stacking (stable algorithm), slider ticks/reverse arrows/ball, hit animations, snaking sliders
- [x] Selection: click, Ctrl/Shift+click, box select on playfield and timeline, Ctrl+A
- [x] Move (drag, Ctrl+arrows), time-move in timeline (drag, J/K), lock notes (L)
- [x] Cut/copy/paste (copy also puts the `00:12:345 (1,2,3) - ` timestamp on the clipboard), clone (Ctrl+D), delete
- [x] Flip H/V (Ctrl+H/J), rotate 90° (Ctrl+,/.), rotate by…, scale by…, reverse selection (Ctrl+G)
- [x] Polygon circles (Ctrl+Shift+D), convert slider to stream (Ctrl+Shift+F), resnap notes
- [x] New combo (Q), colour skip
- [x] Hitsounds: whistle/finish/clap (W/E/R), sampleset and addition set (Shift/Ctrl+Q–R), per-object volume and custom index, per-edge slider hitsounds (click an edge in the timeline)
- [x] Hitsound playback with default samples and beatmap custom samples (`soft-hitclap2.wav` etc.), slider slide/whistle loops, spinner spin sound
- [x] Optional song waveform in the timeline (View → Timeline waveform)
- [x] AiMod (Ctrl+Shift+A): unsnapped objects, overlaps, off-screen, missing files/metadata, breaks…
- [x] osu!taiko (don/kat/big, drumrolls, dendens), osu!mania (columns, notes, holds), osu!catch (scrolling catch view: fruits/juice streams/banana showers, juice streams placed by clicking (time, x) vertices, catch-style distance snap, hyperdash highlighting, catcher preview)

**Timing (F3 / F6)**
- [x] Red and green lines (Ctrl+P / Ctrl+Shift+P), delete (Ctrl+I)
- [x] BPM, offset, meter, sample set, custom index, volume, kiai, omit first bar line
- [x] Tap tempo, offset/BPM nudging, metronome
- [x] Bookmarks, preview point, break periods (auto-generate)

**Song setup (F4)**
- [x] Metadata (unicode + romanised), difficulty sliders (HP/CS/AR/OD/key count, slider velocity, tick rate), audio settings, background & video, combo colours, slider border/track, countdown, letterbox, widescreen, epilepsy warning, stack leniency, mode

**Playback / navigation**
- [x] Play/pause/stop, 25/50/75/100% playback (pitch preserved), Ctrl+↑/↓ speed
- [x] Wheel seeking by beat snap (wheel up = forward, as in stable), Shift 4x, Ctrl+wheel divisor, timing point / bookmark jumps, Z/X/C/V
- [x] Coloured beat snap ticks (1/1 … 1/16), timeline zoom, song overview with kiai/breaks/bookmarks
- [x] Test mode (F5): playable osu!standard with judgements and autoplay; preview for other modes

**Design (F2)**
- [x] Storyboard script editing (.osb and difficulty events), preserved on export
- [x] Storyboard playback in the compose background and Design preview: sprites, animations, F/M/MX/MY/S/V/R/C/P, loops, HitSound triggers, all 35 easings, [Variables], widescreen, storyboard samples
- [x] Visual sprite editor: add from the library (drag onto the preview), select/drag to move (keyframes at the current time), Shift+drag scale, Ctrl+drag rotate, per-time property keyframes, command list with easing, layers/origin/draw order, .osb vs difficulty, undo
- [x] Video playback in the editor background, synced to the music (formats the browser can decode: mp4/H.264, webm)

## Credits

Default hitsound samples (including `spinnerspin.wav`) are from [ppy/osu-resources](https://github.com/ppy/osu-resources) (CC BY-NC 4.0). Slider maths follows osu-framework's `PathApproximator`. This project isn't affiliated with ppy.
