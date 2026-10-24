# osu! web editor

An osu! (stable) style beatmap editor that runs in any modern browser. Drop an mp3 to start a new map, or open an `.osz` / beatmap folder to keep editing. When you're done, export the `.osz` (or a single `.osu`) and open it in osu!. Uploading to the osu! website isn't supported; use the real client for that.

It follows stable's flow: you start in an edit-mode song select with your maps, open one into the editor, and Esc takes you back. Like stable, nothing autosaves: Ctrl+S saves the set in the browser (IndexedDB), and leaving with unsaved changes asks first. If you connect your Google Drive (optional), saving also syncs your maps to a "Beatmap Web Editor" folder in it, so they're there when you open the editor on another computer. Logging in with osu! (also optional) signs new maps with your name.

## Architecture

- **Frontend** (`src/`): Vite + React + TypeScript, built to static files. Everything editor-related runs in the browser; projects are saved to IndexedDB with Ctrl+S. `src/songselect/` is the song select, `src/editor/` the editor, `src/ui/` the in-game and Windows-style dialogs.
- **API** (`server/app.ts`): a small Hono app for osu! OAuth, osu! API lookups (a set's status, your uploaded maps) and the Google Drive sign-in. It runs as a Vercel Function (`api/index.ts`) or as a plain Node server (`server/index.ts`, used by `npm run dev` and Docker).
- **No database**: the osu! login session and the Google refresh token are AES-GCM encrypted httpOnly cookies (`server/seal.ts`), keyed from the OAuth client secrets, so the server is stateless.
- **Storage**: beatmaps are never stored on the server. Ctrl+S keeps them in the browser (IndexedDB) and, with Google Drive connected, syncs them straight from the browser to the user's own Drive (`src/project/drive.ts`), one file per set in a "Beatmap Web Editor" folder. Only the `drive.file` scope is used, so the app sees nothing but its own files. The server (`server/drive.ts`) does the OAuth code exchange and hands out short-lived access tokens; the refresh token lives in an AES-GCM encrypted httpOnly cookie, so there's no token table. Sets that are published on osu! (BeatmapSetID > 0) sync as a few KB: the package holds the `.osu` files, any file that differs from what the mirrors serve for the set (checked by SHA-256), and a manifest of the rest, which another device downloads again from the mirrors (`src/project/syncpack.ts`). It warns if the set changed on osu! since. Original maps, and sets the mirrors don't have, sync as a full `.osz` that also opens in osu!.

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
2. Name it (e.g. "osu! web editor"). For **Application Callback URL**, use `http://localhost:5173/api/auth/callback` for local development, or `https://your-domain/api/auth/callback` in production. It must match `OSU_REDIRECT_URI` exactly. You can register both: create a second application for production.
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

`docker build -t osu-web-editor . && docker run -d -p 8787:8787 --env-file .env osu-web-editor`

The container is stateless (no database; maps live in browsers and Google Drive), listens on `PORT` (8787), and exposes `/api/health` for health checks.

### Opening published maps

Song select's "Open a beatmap from osu.ppy.sh" accepts an `osu.ppy.sh/beatmapsets/…` link. The official API doesn't let third-party apps download beatmapsets, so the browser downloads them directly from public mirrors that allow CORS: osu.direct first, then nerinyan. When the app runs on the Node server, it also falls back to a server-side proxy that adds catboy.best. That proxy isn't deployed on Vercel. The "Search & download beatmaps" panel uses osu.direct's search API (also CORS-enabled) and the same downloads.

## Feature checklist (vs. the stable editor)

**Screens & flow**
- [x] Star ratings for all four modes (star dots, difficulty colours and "Star Rating" in the info panel), matching osu.ppy.sh: a port of lazer's difficulty calculators, checked against 467 ranked maps (`STARS_SETS="<set ids>" npx vitest run stars.website` compares more)
- [x] Edit-mode song select: carousel of sets that expand into difficulties, the selected map's background, info panel (length, BPM, object counts, CS/AR/OD/HP), preview point playing on a loop, type-to-search with filters (`ar>9`, `bpm>=180`, `length<90`, `mode=mania`, `creator=…`), Group/Sort dropdowns and tabs, arrow keys / Enter / F2 random / F3 options / Shift+Delete delete dialog, right-click absolute scrolling
- [x] Stable's status box for the selected difficulty: "Latest ranked/qualified/loved/pending version" when it's the version on osu!, "Update to latest version" when it was edited or osu! has a newer one (click, confirm with stable's warning, and the set is replaced with the version on osu!), "Not submitted" otherwise. Difficulties remember the MD5 of the .osu they were imported from, which is osu!'s checksum, so this works even though the editor rewrites .osu files; set info comes from the osu! API through our server (`/api/beatmapsets/:id`), falling back to osu.direct
- [x] "Drop an mp3 file here to start mapping", open .osz / beatmap folder / osu.ppy.sh link, account panel with cloud sync
- [x] Esc leaves the editor (asks Yes/No/Cancel to save when there are unsaved changes); switching difficulty asks the same
- [x] Stable editor layout: Windows-style menu strip, compose/design/timing/song setup tabs, timeline with zoom buttons, Beat Snap Divisor slider, Insert Break Time, position / Prev / Next distance readout, tips line, Sampleset/Additions + tool column, New Combo / Whistle / Finish / Clap / Grid Snap / Distance Snap / Lock Notes toggles, bottom bar with time and %, song overview, play/pause/stop, Test and Playback Rate
- [x] Stable menus: File (Clear All Notes, Open Difficulty → For Editing, Save, Create a new Difficulty, Revert to Saved (Full), Test, AiMod, Export Package, Open Song Folder, Open .osu/.osb in Notepad, Exit), Edit (incl. reset samples / combo colours / breaks), View, Compose, Design, Timing (Time Signature, Resnap Current Section, Move all notes in time, Recalculate Slider Lengths, …), Web, Help
- [x] Windows-style tool windows like stable: Song Setup and Timing and Control Points with OK/Cancel, Rotate by / Scale by with live preview, polygon circles, slider to stream, AiMod
- [x] Letter shortcuts follow the keyboard layout (on AZERTY, W is the key labelled W)

**Files & projects**
- [x] New beatmap from mp3/ogg (reads ID3 artist/title/cover art)
- [x] Open `.osz`, a dropped beatmap folder, or loose `.osu` + assets
- [x] Open published maps by link (direct from CORS-enabled mirrors)
- [x] osu!direct in song select ("Search & download beatmaps"): search by text with status / mode / sort filters (osu.direct search API), audio previews, one-click download with progress straight into song select, "Open" for sets you already have
- [x] Save (Ctrl+S), revert to saved (Ctrl+L), full revert (Ctrl+Shift+L); no autosave, like stable
- [x] Export `.osz` package and single `.osu`
- [x] Multiple difficulties: Create a new Difficulty opens Song Setup to name it, then asks "Would you like to clear all objects and start fresh?" and saves it right away (the current one keeps its last save; flow and wording checked against stable); switch from File → Open Difficulty or Ctrl+O; delete from song select
- [x] Add files to the beatmap folder (custom hitsounds, images, storyboard assets), replace audio
- [x] Lossless round trip of `.osu` files (verified against ranked maps)
- [x] Cloud sync to your own Google Drive (published sets sync only their edited files and come back from the mirrors), optional osu! login

**Compose (F1)**
- [x] Select / circle / slider / spinner tools (1–4), mania note/hold tools
- [x] Slider placement with auto curve type (linear → perfect circle → bézier), red anchors, preview and length snapped to beat divisor, right-click/Enter to finish (controls checked against the osu! wiki)
- [x] Spinners placed like stable: click to start at the current time, seek forward, click again to end
- [x] Slider control point editing: drag, Ctrl+click to toggle red anchor / insert point, right-click to delete
- [x] Slider repeats by dragging the tail in the timeline
- [x] Hovering a slider with the select tool shows its control points (draggable right away)
- [x] Grid snap (T, Shift to toggle temporarily), grid sizes (G, Ctrl+1–4), distance snap (Y, Alt temporarily) with distance spacing (Alt+wheel)
- [x] Skins (View → Options): osu!default (stable's default skin from osu-resources), a drawn style, or your own skin imported from an .osk or skin folder (kept in this browser, never uploaded); missing elements fall back to osu!default, skin.ini combo/slider colours and HitCircleOverlap/prefix are read, skin hitsounds replace the defaults. osu!standard compose and test mode use it (taiko/mania/catch and the timeline are still drawn)
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
- [x] Timing tab like stable: BPM / Offset / Slider Velocity / Slider Tick Rate spinners (Shift ×5, Ctrl fine), "Move already placed notes when changing the offset/BPM", slider velocity preview, metronome with Reset / Tap Here! (T) and bar:beat readout, timing point flags in the timeline
- [x] Timing and Control Points (F6): Timing/Audio/Style tabs, All/Timing Points/Inherited Points list with Ctrl/Shift multi-select, inherit previous settings, scale/snap objects, resnap sliders and adjust bookmarks when applying
- [x] Bookmarks, preview point, break periods (auto-generate)

**Song setup (F4)**
- [x] Stable's tabs and wording: metadata (unicode + romanised, greyed when not needed), difficulty (HP/CS/AR/OD/key count), audio (default sampleset, custom overrides, sample volume, hitsound previews), colours (Enable Custom Colours, New/Remove Combo Colour), design (countdown + speed + offset, widescreen, epilepsy warning, letterbox), advanced (stack leniency, Allowed Modes, N+1 style); background & video, slider border/track

**Playback / navigation**
- [x] Play/pause/stop, 25/50/75/100% playback (pitch preserved), Ctrl+↑/↓ speed
- [x] Volume overlay like stable: Alt+wheel shows master/music/effect meters in the bottom right and changes master, or the meter under the cursor (in the editor only in the bottom-right corner; elsewhere Alt+wheel keeps distance spacing / timeline zoom, as in stable)
- [x] Wheel seeking by beat snap (wheel down = forward), eased like lazer, touchpad deltas grouped per notch, Shift 4x, Ctrl+wheel divisor, timing point / bookmark jumps, Z/X/C/V
- [x] Exact seeking: browsers seek compressed audio only approximately (in VBR mp3s up to a few hundred ms off, measured in Edge), so the editor plays a decoded WAV copy of the song, which seeks to the sample; the clock also corrects itself when the audio is slow to resume after a seek
- [x] Coloured beat snap ticks (1/1 … 1/16), timeline zoom, song overview with kiai/breaks/bookmarks
- [x] Test mode (F5): playable osu!standard with judgements and autoplay; preview for other modes

**Design (F2)**
- [x] Stable layout: Layer Toggles (incl. HitObjects), Transformation (move/scale/fade/rotate/colour), Tweening, Easing In/Out, Origin, Diff. Specific; Movement/Scale/Fade/Rotation keyframe timeline; Keyframe Control (+ / − / previous / next); Background Image/Video toggle; SB load readout; Sprite Library (I); W/A/S/D nudge; Ctrl+X/C/V sprites
- [x] Storyboard script editing (.osb and difficulty events), preserved on export
- [x] Storyboard playback in the compose background and Design preview: sprites, animations, F/M/MX/MY/S/V/R/C/P, loops, HitSound triggers, all 35 easings, [Variables], widescreen, storyboard samples
- [x] Visual sprite editor: add from the library (drag onto the preview), select/drag to move (keyframes at the current time), Shift+drag scale, Ctrl+drag rotate, per-time property keyframes, command list with easing, layers/origin/draw order, .osb vs difficulty, undo
- [x] Video playback in the editor background, synced to the music (formats the browser can decode: mp4/H.264, webm)

**Not yet**
- [ ] Live mapping mode (Ctrl+Tab, which browsers keep for switching tabs), osu!mania sample import and "Open Difficulty → For Reference" (osu!mania only in stable): out of scope, this editor is for osu!standard
- [ ] Upload Beatmap (use the real client)

## Credits

Default hitsound samples (including `spinnerspin.wav`) and the osu!default skin images in `public/skins/default` are from [ppy/osu-resources](https://github.com/ppy/osu-resources) (CC BY-NC 4.0), unmodified. Slider maths follows osu-framework's `PathApproximator`. Star ratings are a TypeScript port of the difficulty calculators in [ppy/osu](https://github.com/ppy/osu) (lazer, MIT licence, version 2026.730.0, which is what osu.ppy.sh runs), together with lazer's `SliderPath` and osu-framework's `PathApproximator` (also MIT) in single precision. The UI font is [Ubuntu](https://design.ubuntu.com/font) (Ubuntu Font Licence), standing in for stable's Aller; icons are drawn in SVG, and no files are copied from an osu! install. This project isn't affiliated with ppy.
