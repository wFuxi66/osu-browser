# osu!browser

**Live at <https://osu-browser.vercel.app>**

The app is called osu!browser. The repository, npm package, Docker image and URLs drop the `!` (`osu-browser`), because that's easier for folder names and links.

osu!browser puts osu! (stable) in a browser tab: play your maps and map them, on any laptop. Drop an mp3 to start a new map, or open an `.osz` / beatmap folder to keep editing or to play it. When you're done, export the `.osz` (or a single `.osu`) and open it in osu!. Uploading to the osu! website isn't supported; use the real client for that.

It follows stable's flow: the main menu (the cookie: Play, Edit, Options, Exit), then song select in play or edit mode, then the game or the editor; Esc or "back" takes you back each time. Playing is mostly there to test your maps: scores stay in the browser, in song select's local ranking. Like stable, nothing autosaves in the editor: Ctrl+S saves the set in the browser (IndexedDB), and leaving with unsaved changes asks first. If you connect your Google Drive (optional), saving also syncs your maps to an "osu-browser" folder in it, so they're there when you open the app on another computer. Logging in with osu! (also optional) signs new maps with your name.

## Architecture

A static single-page app with a small, optional API beside it. Maps, scores, skins and settings live in the browser; the server only handles sign-ins and osu! API lookups.

**Frontend** (`src/`, Vite + React + TypeScript, built to static files)

| Folder | What's in it |
| --- | --- |
| `src/osu/` | The beatmap format: `.osu` parser and lossless serializer, timing, slider curves, stacking, `.osb` storyboards, MD5 checksums, star rating calculators (`difficulty/`, ported from lazer) |
| `src/menu/` | Main menu (the cookie) and Now Playing |
| `src/songselect/` | Song select carousel, search filters, osu!direct panel, Recently deleted |
| `src/play/` | Gameplay: osu!standard judging and scoring, mods, HUD, ranking screen, local scores |
| `src/editor/` | The editor: state and undo (`store.ts`), playfield and timeline rendering, compose/design/timing tools, storyboard editor, AiMod, shortcuts, video playback and conversion |
| `src/audio/` | Music clock with sample-exact seeking (decoded in a worker), hitsounds, waveform |
| `src/skin/` | Skin loading (`.osk`, skin folders, osu!default) and the cursor |
| `src/project/` | Opening and saving sets: `.osz`/folder import, IndexedDB storage, mirror downloads, osu.ppy.sh deep links, Google Drive sync (`drive.ts`, `cloud.ts`, `syncpack.ts`) |
| `src/ui/` | Options panel, Windows-style dialogs, volume overlay, screen transitions, touch controls |
| `src/pwa/` | Service worker (offline, update toast) and "Install as an app" |
| `src/changelog.ts` | Player-facing "What's new" lines |

**API** (`server/app.ts`): a small Hono app for osu! OAuth, osu! API lookups (a set's status, your uploaded maps) and the Google Drive sign-in. It runs as a Vercel Function (`api/index.ts`) or as a plain Node server (`server/index.ts`, used by `npm run dev` and Docker). Without OAuth configured, everything else still works.

**No database**: the osu! login session and the Google refresh token are AES-GCM encrypted httpOnly cookies (`server/seal.ts`), keyed from the OAuth client secrets, so the server is stateless.

**Storage**: beatmaps are never stored on the server. Ctrl+S keeps them in the browser (IndexedDB) and, with Google Drive connected, syncs them straight from the browser to the user's own Drive, one file per set in an "osu-browser" folder. Only the `drive.file` scope is used, so the app sees nothing but its own files; the server (`server/drive.ts`) only does the OAuth code exchange and hands out short-lived access tokens. Sets published on osu! (BeatmapSetID > 0) sync as a few KB: the `.osu` files, any file that differs from what the mirrors serve (checked by SHA-256), and a manifest of the rest, which another device downloads again from the mirrors (`src/project/syncpack.ts`). Original maps, and sets the mirrors don't have, sync as a full `.osz` that also opens in osu!.

## Running locally

Requires Node.js 22.18+ (Node 24 recommended).

```sh
npm install
cp .env.example .env     # optional: only needed for osu! login / Drive sync (osu! and Google OAuth apps)
npm run dev              # web on http://localhost:5173, API on :8787
```

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build` then `npm start` (serves the built app + API on one port).

### Enabling "Log in with osu!"

1. Sign in on osu.ppy.sh and open <https://osu.ppy.sh/home/account/edit#oauth>, then click **New OAuth Application**.
2. Name it (e.g. "osu!browser"). For **Application Callback URL**, use `http://localhost:5173/api/auth/callback` for local development, or `https://your-domain/api/auth/callback` in production. It must match `OSU_REDIRECT_URI` exactly. You can register both: create a second application for production.
3. Copy the **Client ID** and **Client Secret** into `.env` (`OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`). In production also set `PUBLIC_URL=https://your-domain` and `OSU_REDIRECT_URI=https://your-domain/api/auth/callback`.

osu!'s OAuth needs a client secret for the token exchange, which is why there's a small backend. The session is an encrypted httpOnly cookie holding only who you are (id, name, avatar, country); the user's osu! token is dropped after sign-in, and the osu! API calls use the app's own client-credentials token. The editor only asks for the `identify public` scopes. Logging in signs new maps with your name and adds **My beatmaps** to the osu!direct panel: your pending/WIP, ranked, loved, graveyarded sets and guest difficulties, one click to open them. Without OAuth configured, the editor still works fully offline/local.

### Deploying

**Vercel (recommended, no server needed):**

`vercel.json` builds the Vite app as static files, rewrites `/api/*` to the Hono function in `api/index.ts`, rewrites every other path to `index.html`, and pins the function to `fra1`.

```sh
npx vercel link
npx vercel env add OSU_CLIENT_ID production          # repeat for each variable below
npx vercel deploy --prod
```

Environment variables: `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`, `PUBLIC_URL` (e.g. `https://your-app.vercel.app`), `OSU_REDIRECT_URI` (`$PUBLIC_URL/api/auth/callback`), and for Drive sync `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Check it with `curl https://your-app.vercel.app/api/health`. `.vercelignore` keeps your local `.env` out of CLI uploads.

**Docker Compose with automatic HTTPS (any VPS):**

1. Point a domain (A/AAAA record) at the server, and open ports 80 and 443.
2. On the server: `git clone` this repo, then `cp .env.example .env` and fill in the production values above.
3. `DOMAIN=editor.example.com docker compose up -d --build`

Caddy obtains the TLS certificate and proxies to the app. Check it with `curl https://editor.example.com/api/health`. To update: `git pull && DOMAIN=… docker compose up -d --build`.

**Plain Docker (behind your own proxy, or on Fly.io/Railway/Render):**

`docker build -t osu-browser . && docker run -d -p 8787:8787 --env-file .env osu-browser`

The container is stateless (no database; maps live in browsers and Google Drive), listens on `PORT` (8787), and exposes `/api/health` for health checks.

### Opening published maps

Song select's "Open a beatmap from osu.ppy.sh" accepts an `osu.ppy.sh/beatmapsets/…` link. The official API doesn't let third-party apps download beatmapsets, so the browser downloads them directly from public mirrors that allow CORS: osu.direct first, then nerinyan. When the app runs on the Node server, it also falls back to a server-side proxy that adds catboy.best. That proxy isn't deployed on Vercel. The "Search & download beatmaps" panel uses osu.direct's search API (also CORS-enabled) and the same downloads.

The app also opens osu.ppy.sh's own paths: `https://osu-browser.vercel.app/beatmapsets/123456#osu/789` opens that difficulty in the editor, using the copy in song select when there is one (so local edits are never replaced) and downloading the set otherwise. With Drive sync on, it syncs first, so a set saved on another computer isn't downloaded twice. Discussion pages (`/beatmapsets/123456/discussion/789/…`) work too. Two ways to get there from a beatmap page:

- **Userscript:** with [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey installed, open <https://osu-browser.vercel.app/osu-browser.user.js> and install it. Beatmap pages then have an "Edit in osu!browser" button next to Download.
- **Bookmarklet:** bookmark this and click it on a beatmap page: `javascript:location.href='https://osu-browser.vercel.app'+location.pathname+location.hash`

Self-hosting? Change the address in `public/osu-browser.user.js` (and in the bookmarklet).

## Better than stable

osu!browser follows stable, but being a web app (and coming years later) lets it do a few things stable doesn't:

- **Runs anywhere**: any laptop, Chromebook, tablet or phone, with nothing to install. It can be installed as an app and works offline. Phones get a layout with the menus on the sides, and touch controls (multi-select on the timeline, flings).
- **Your maps follow you**: optional Google Drive sync of maps and settings between computers. Published sets sync as a few KB, and a map changed in two places keeps both versions instead of losing one.
- **Open maps from the website**: `osu-browser.vercel.app/beatmapsets/…` links (discussion links too) open that difficulty in the editor, and a userscript adds an "Edit in osu!browser" button to beatmap pages.
- **osu!direct without supporter**: search, preview and download sets from song select, plus "My beatmaps" for your own sets and guest difficulties when logged in.
- **Star ratings that match the website**: all four modes use the current osu.ppy.sh calculators, not stable's older values.
- **Mapping tools built in**: Slider Completionator and Slider Merger (as in Mapping Tools) in the Tools menu, no separate program.
- **Timeline waveform** (View → Timeline waveform).
- **Any background video plays**: `.avi`/`.flv` and old codecs are converted in the browser for the editor; the set keeps its original file.
- **Recently deleted**: deleted sets and difficulties can be restored for 30 days.
- **Keyboard layout aware**: letter shortcuts follow your layout (on AZERTY, W is the key labelled W), and every editor shortcut, test mode's hit keys included, can be rebound.
- **What's new**: when an update is ready, the toast lists what changed before you reload.

Not there yet: osu!taiko, osu!catch and osu!mania can be mapped but only previewed with autoplay, not played; no live mapping mode (browsers keep Ctrl+Tab); no Upload Beatmap (use the real client).

## Contributing

Issues and pull requests are welcome.

- **Stable is the reference.** Anything that behaves differently from osu! stable is a bug, unless it's listed under "Better than stable". The most useful report is "in stable, X does Y; here it does Z", with the map (a link or `.osz`) and a timestamp when it matters.
- **Open an issue first** for a large change or a new feature, so we can agree it fits.
- **Match the surrounding code**: naming, comment style and structure of the file you're in. Avoid new runtime dependencies; the app ships as static files.
- **Tests**: add a Vitest test next to the code (`*.test.ts`) for parsing, judging, sync, or anything with one right answer. `.osu` round trips must stay lossless (`src/osu/fidelity.test.ts`).
- **Changelog**: if players will notice the change, add one line at the top of `src/changelog.ts`. The update toast shows it, so write it for players, and don't reword lines that have shipped (they're matched by text).
- **Before opening a pull request**: `npm run typecheck` and `npm test` must pass. Keep commits focused, with one-line messages like `feat(editor): …` or `fix(play): …`.
- **No copied osu! code or files**: don't take files from an osu! install, or code from GPL projects such as Mapping Tools; reimplement from behaviour. MIT code from ppy/osu and assets from ppy/osu-resources are fine, with attribution in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

## Credits

- **Samples and the osu!default skin**: hitsounds, gameplay samples (`spinnerspin.wav`, `combobreak.mp3`, `applause.mp3`, …) and skin images are from [ppy/osu-resources](https://github.com/ppy/osu-resources), unmodified.
- **Star ratings and slider paths**: a TypeScript port of the difficulty calculators in [ppy/osu](https://github.com/ppy/osu) (lazer 2026.730.0, which is what osu.ppy.sh runs), with lazer's `SliderPath` and [osu-framework](https://github.com/ppy/osu-framework)'s `PathApproximator`, in single precision.
- **Mapping tools**: Slider Completionator and Slider Merger behave like the tools of the same names in OliBomby's [Mapping Tools](https://github.com/OliBomby/Mapping_Tools). They're written from scratch; no code is taken from it.
- **Video conversion**: [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (FFmpeg with libx264).
- **Beatmap mirrors**: [osu.direct](https://osu.direct) (search and downloads), [nerinyan](https://nerinyan.moe) and [catboy.best](https://catboy.best) (downloads).
- **Font**: [Ubuntu](https://design.ubuntu.com/font), standing in for stable's Aller. Icons are drawn in SVG.
- Built with [React](https://react.dev), [Vite](https://vite.dev), [Hono](https://hono.dev) and [JSZip](https://stuk.github.io/jszip/).

No files are copied from an osu! install. This project isn't affiliated with or endorsed by ppy Pty Ltd.

## Licence

The code is under the [MIT License](LICENSE). Some parts keep their own licences (full texts in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)):

| What | Where | Licence |
| --- | --- | --- |
| osu!browser | everything not listed below | MIT |
| Code ported from ppy/osu and osu-framework | `src/osu/difficulty/`, slider path maths | MIT (ppy Pty Ltd) |
| Samples and osu!default skin from osu-resources | `public/samples`, `public/skins/default` | CC BY-NC 4.0, non-commercial (see the `ATTRIBUTION.md` files there) |
| FFmpeg build used by the video converter | `@ffmpeg/core`, from npm, unmodified | GPL-2.0-or-later |
| Ubuntu font | `@fontsource/ubuntu` | Ubuntu Font Licence |

Because of the CC BY-NC assets, a deployment that includes them can't be used commercially. osu! is a trademark of ppy Pty Ltd.
