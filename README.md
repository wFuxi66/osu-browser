# osu!browser

**Live at <https://osu-browser.vercel.app>**

The app is called osu!browser. The repository, npm package, Docker image and URLs drop the `!` (`osu-browser`), because that's easier for folder names and links.

osu!browser puts osu! (stable) in a browser tab: play your maps and map them, on any laptop. Drop an mp3 to start a new map, or open an `.osz` / beatmap folder to keep editing or to play it. When you're done, export the `.osz` (or a single `.osu`) and open it in osu!. Uploading to the osu! website isn't supported; use the real client for that.

It follows stable's flow: the main menu (the cookie: Play, Edit, Options, Exit), then song select in play or edit mode, then the game or the editor; Esc or "back" takes you back each time. Playing is mostly there to test your maps: scores stay in the browser, in song select's local ranking. Like stable, nothing autosaves in the editor: Ctrl+S saves the set in the browser (IndexedDB), and leaving with unsaved changes asks first. If you connect your Google Drive (optional), saving also syncs your maps to an "osu-browser" folder in it, so they're there when you open the app on another computer. Logging in with osu! (also optional) signs new maps with your name.

## Architecture

- **Frontend** (`src/`): Vite + React + TypeScript, built to static files. Everything editor-related runs in the browser; projects are saved to IndexedDB with Ctrl+S. `src/songselect/` is the song select, `src/editor/` the editor, `src/ui/` the in-game and Windows-style dialogs.
- **API** (`server/app.ts`): a small Hono app for osu! OAuth, osu! API lookups (a set's status, your uploaded maps) and the Google Drive sign-in. It runs as a Vercel Function (`api/index.ts`) or as a plain Node server (`server/index.ts`, used by `npm run dev` and Docker).
- **No database**: the osu! login session and the Google refresh token are AES-GCM encrypted httpOnly cookies (`server/seal.ts`), keyed from the OAuth client secrets, so the server is stateless.
- **Storage**: beatmaps are never stored on the server. Ctrl+S keeps them in the browser (IndexedDB) and, with Google Drive connected, syncs them straight from the browser to the user's own Drive (`src/project/drive.ts`), one file per set in an "osu-browser" folder. Only the `drive.file` scope is used, so the app sees nothing but its own files. The server (`server/drive.ts`) does the OAuth code exchange and hands out short-lived access tokens; the refresh token lives in an AES-GCM encrypted httpOnly cookie, so there's no token table. Sets that are published on osu! (BeatmapSetID > 0) sync as a few KB: the package holds the `.osu` files, any file that differs from what the mirrors serve for the set (checked by SHA-256), and a manifest of the rest, which another device downloads again from the mirrors (`src/project/syncpack.ts`). It warns if the set changed on osu! since. Original maps, and sets the mirrors don't have, sync as a full `.osz` that also opens in osu!.

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

## Feature checklist (vs. stable)

**Main menu & play mode**
- [x] Stable's main menu: the cookie pulsing on the beat (brighter in kiai) with a visualiser ring, Play / Edit / Options / Exit sliding out (P, E, O, D for osu!direct), user panel with local plays and accuracy, "You have N beatmaps available!", Now Playing with previous/play/pause/stop/next and a seek bar, the current song's background with parallax, menu tips. The song carries on between the menu and song select
- [x] Play-mode song select: Enter plays, Ctrl+Enter plays with Autoplay, F1 mod selection, local ranking (click a score for its ranking screen, right-click to delete it), the info panel's stats and star rating with the selected mods (AR/OD at Double Time's speed, like stable)
- [x] Mod selection like stable's: Difficulty Reduction (EZ NF HT), Difficulty Increase (HR SD/PF DT/NC HD FL), Special (RX AP SO AU/CN V2), score multiplier, Q W E / A S D F G / Z X C V B keys, 1 reset, 2 close; icons come from the skin's `selection-mod-*.png` when it has them
- [x] osu!standard gameplay as stable judges it: 300/100/50 windows from OD, notelock (and the early-click miss), sliders scored on head, ticks, repeats and tail (36 ms leniency, follow circle 2.4× once tracking), spinners by rotations (capped at 477 rpm), health drain with breaks, 激/喝, ScoreV1 (difficulty and mod multipliers) or ScoreV2, SS/S/A/B/C/D (silver with HD/FL). Easy's three lives, Sudden Death, Perfect, Relax, Autopilot, Spun Out, Autoplay, Cinema
- [x] HUD like stable's, skinned when the skin has the images (score/combo fonts, health bar, grades, hit bursts, 激/喝): progress pie or bar, hit error meter, key overlay, live local leaderboard, section pass/fail and break arrows, FPS counter. Hitsounds follow your hits (and stop when a slider is dropped); combobreak, fail and applause sounds
- [x] Lead-in before early first objects, Skip (Space), pause on Esc or when the tab loses focus (Continue asks you to click where the cursor was, like stable), quick retry (`), fail with the song winding down, ranking screen with hit counts, max combo, accuracy, health graph and unstable rate
- [x] Gameplay options from stable: background dim (lighter in breaks unless turned off), leaderboard, progress display, score meter type and size, key overlay, approach circle on the first Hidden object, snaking sliders, video, storyboards, ignore beatmap hitsounds, cursor size and automatic cursor size, mouse wheel (changes the volume while playing) and mouse buttons in play mode, song select thumbnails, menu parallax and tips, delete all local scores
- [ ] osu!taiko, osu!catch and osu!mania are shown as an autoplay preview, not playable yet

**Screens & flow**
- [x] Star ratings for all four modes (star dots, difficulty colours and "Star Rating" in the info panel), matching osu.ppy.sh: a port of lazer's difficulty calculators, checked against 467 ranked maps (`STARS_SETS="<set ids>" npx vitest run stars.website` compares more)
- [x] Edit-mode song select: carousel of sets that expand into difficulties, the selected map's background, info panel (length, BPM, object counts, CS/AR/OD/HP), preview point playing on a loop, type-to-search with filters (`ar>9`, `bpm>=180`, `length<90`, `mode=mania`, `creator=…`), Group/Sort dropdowns and tabs, arrow keys / Enter / F2 random / F3 options / Shift+Delete delete dialog, right-click absolute scrolling
- [x] Stable's status box for the selected difficulty: "Latest ranked/qualified/loved/pending version" when it's the version on osu!, "Update to latest version" when it was edited or osu! has a newer one (click, confirm with stable's warning, and the set is replaced with the version on osu!), "Not submitted" otherwise. Difficulties remember the MD5 of the .osu they were imported from, which is osu!'s checksum, so this works even though the editor rewrites .osu files; set info comes from the osu! API through our server (`/api/beatmapsets/:id`), falling back to osu.direct
- [x] "Drop an mp3 file here to start mapping", open .osz / beatmap folder / osu.ppy.sh link, account panel with cloud sync
- [x] Esc leaves the editor (asks Yes/No/Cancel to save when there are unsaved changes); switching difficulty asks the same. Back in song select the song carries on from where you left it, and reopening a difficulty returns to the time you left it at (remembered per difficulty, also across reloads), like stable
- [x] Stable editor layout: Windows-style menu strip, compose/design/timing/song setup tabs, timeline with zoom buttons, Beat Snap Divisor slider, Insert Break Time, position / Prev / Next distance readout, tips line, Sampleset/Additions + tool column, New Combo / Whistle / Finish / Clap / Grid Snap / Distance Snap / Lock Notes toggles, bottom bar with time and %, song overview, play/pause/stop, Test and Playback Rate
- [x] Stable menus: File (Clear All Notes, Open Difficulty → For Editing, Save, Create a new Difficulty, Revert to Saved (Full), Test, AiMod, Export Package, Open Song Folder, Open .osu/.osb in Notepad, Exit), Edit (incl. reset samples / combo colours / breaks), View, Compose, Design, Timing (Time Signature, Resnap Current Section, Move all notes in time, Recalculate Slider Lengths, …), Web, Help
- [x] Windows-style tool windows like stable: Song Setup and Timing and Control Points with OK/Cancel, Rotate by / Scale by with live preview, polygon circles, slider to stream, AiMod
- [x] Letter shortcuts follow the keyboard layout (on AZERTY, W is the key labelled W)
- [x] Options panel like stable's (gear in song select, Ctrl+O, or View → Options in the editor), with search: osu! account and Google Drive, creator name, volumes and offset, skin, editor display, downloads, and every editor shortcut rebindable (click a key, press the new one; right-click removes it), test mode's hit keys included. Menus, tooltips and the help screen show your keys
- [x] Settings sync between computers through Google Drive (newest wins; the audio offset and imported skins stay per computer)

**Files & projects**
- [x] New beatmap from mp3/ogg (reads ID3 artist/title/cover art)
- [x] Open `.osz`, a dropped beatmap folder, or loose `.osu` + assets
- [x] Open published maps by link (direct from CORS-enabled mirrors)
- [x] osu!direct in song select ("Search & download beatmaps"): search by text with status / mode / sort filters (osu.direct search API), audio previews, one-click download with progress straight into song select, "Open" for sets you already have, with or without video (Options → Downloads). Logged in with osu!, "My beatmaps" lists your pending/WIP, ranked, loved, graveyarded sets and guest difficulties from the osu! API
- [x] Save (Ctrl+S), revert to saved (Ctrl+L), full revert (Ctrl+Shift+L); no autosave, like stable
- [x] Export `.osz` package and single `.osu`
- [x] Multiple difficulties: Create a new Difficulty opens Song Setup to name it, then asks "Would you like to clear all objects and start fresh?" and saves it right away (the current one keeps its last save; flow and wording checked against stable); switch from File → Open Difficulty or Ctrl+O; delete from song select
- [x] Add files to the beatmap folder (custom hitsounds, images, storyboard assets), replace audio
- [x] Lossless round trip of `.osu` files (verified against ranked maps)
- [x] Cloud sync to your own Google Drive (published sets sync only their edited files and come back from the mirrors), offered once after the first save; optional osu! login

**Compose (F1)**
- [x] Select / circle / slider / spinner tools (1–4), mania note/hold tools
- [x] Slider placement with auto curve type (linear → perfect circle → bézier), red anchors, preview and length snapped to beat divisor, right-click/Enter to finish (controls checked against the osu! wiki)
- [x] Spinners placed like stable: click to start at the current time, seek forward, click again to end
- [x] Slider control point editing: drag, Ctrl+click to toggle red anchor / insert point, right-click to delete
- [x] Slider repeats by dragging the tail in the timeline
- [x] Hovering a slider with the select tool shows its control points (draggable right away)
- [x] Playfield grid always shown, like stable (G / Ctrl+1–4 change its size; View → Show Grid hides it), grid snap (T, Shift to toggle temporarily), distance snap (Y, Alt temporarily) with distance spacing (Alt+wheel)
- [x] Skins (View → Options): osu!default (stable's default skin from osu-resources), a drawn style, or your own skin imported from an .osk or skin folder (kept in this browser, never uploaded); missing elements fall back to osu!default, skin.ini combo/slider colours and HitCircleOverlap/prefix are read, skin hitsounds replace the defaults. osu!standard compose, the timeline and test mode use it (taiko/mania/catch are still drawn). Optionally, a beatmap's own skin images (hitcircle.png etc. in its folder) are used over yours
- [x] Approach circles, follow points, combo numbers & colours (stable colour indexing), stacking (stable algorithm), slider ticks/reverse arrows/ball, hit animations, snaking sliders
- [x] Selection: click, Ctrl/Shift+click, box select on playfield and timeline, Ctrl+A
- [x] Move (drag, Ctrl+arrows), time-move in timeline (drag, J/K), lock notes (L)
- [x] Cut/copy/paste (copy also puts the `00:12:345 (1,2,3) - ` timestamp on the clipboard), clone (Ctrl+D), delete
- [x] Flip H/V (Ctrl+H/J), rotate 90° (Ctrl+,/.), rotate by…, scale by…, reverse selection (Ctrl+G)
- [x] Polygon circles (Ctrl+Shift+D), convert slider to stream (Ctrl+Shift+F), resnap notes
- [x] Tools menu (not in stable; these are usually run from [Mapping Tools](https://github.com/OliBomby/Mapping_Tools), which can't reach maps in a browser): **Slider Completionator** works out the SV, length or duration of the selected sliders from the other two (by default it makes a slider end on its last anchor without moving its end time), adding green lines that keep the section's volume and samples and putting back the SV of the sliders after them; **Slider Merger** joins neighbouring selected circles and sliders that touch (within a leniency) into one slider, converting perfect-circle and Catmull curves to Bézier
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
- [x] Test mode (F5): plays from the current time without failing, with quick Autoplay/HT/DT/EZ/HR/HD/FL toggles; Esc goes back to where you were (preview for other modes)

**Design (F2)**
- [x] Stable layout: Layer Toggles (incl. HitObjects), Transformation (move/scale/fade/rotate/colour), Tweening, Easing In/Out, Origin, Diff. Specific; Movement/Scale/Fade/Rotation keyframe timeline; Keyframe Control (+ / − / previous / next); Background Image/Video toggle; SB load readout; Sprite Library (I); W/A/S/D nudge; Ctrl+X/C/V sprites
- [x] Storyboard script editing (.osb and difficulty events), preserved on export
- [x] Storyboard playback in the compose background and Design preview: sprites, animations, F/M/MX/MY/S/V/R/C/P, loops, HitSound triggers, all 35 easings, [Variables], widescreen, storyboard samples
- [x] Visual sprite editor: add from the library (drag onto the preview), select/drag to move (keyframes at the current time), Shift+drag scale, Ctrl+drag rotate, per-time property keyframes, command list with easing, layers/origin/draw order, .osb vs difficulty, undo
- [x] Video playback in the editor background, synced to the music. Videos the browser can't play (.avi, .flv, old codecs) are converted to 720p H.264 in the browser with ffmpeg.wasm the first time, and the copy is cached; the set keeps its original file

**Not yet**
- [ ] Live mapping mode (Ctrl+Tab, which browsers keep for switching tabs), osu!mania sample import and "Open Difficulty → For Reference" (osu!mania only in stable): out of scope, this editor is for osu!standard
- [ ] Upload Beatmap (use the real client)

## Contributing

Issues and pull requests are welcome. The rule is that osu! stable is the reference: anything that behaves differently from stable is a bug, so the most useful report is "in stable, X does Y; here it does Z". Open an issue before a large change, and run `npm run typecheck` and `npm test` before opening a pull request.

## Credits

Default hitsound and gameplay samples (including `spinnerspin.wav`, `combobreak.mp3`, `applause.mp3`) and the osu!default skin images in `public/skins/default` are from [ppy/osu-resources](https://github.com/ppy/osu-resources) (CC BY-NC 4.0), unmodified. Slider maths follows osu-framework's `PathApproximator`. Slider Completionator and Slider Merger behave like the tools of the same names in OliBomby's [Mapping Tools](https://github.com/OliBomby/Mapping_Tools) (GPL-3.0); they're written from scratch, with no code taken from it. Star ratings are a TypeScript port of the difficulty calculators in [ppy/osu](https://github.com/ppy/osu) (lazer, MIT licence, version 2026.730.0, which is what osu.ppy.sh runs), together with lazer's `SliderPath` and osu-framework's `PathApproximator` (also MIT) in single precision. The UI font is [Ubuntu](https://design.ubuntu.com/font) (Ubuntu Font Licence), standing in for stable's Aller; icons are drawn in SVG, and no files are copied from an osu! install. This project isn't affiliated with ppy.

## Licence

The code is under the [MIT License](LICENSE); third-party code and assets are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). The osu!-resources samples and skin images in `public/samples` and `public/skins/default` stay under CC BY-NC 4.0 (non-commercial, see the `ATTRIBUTION.md` files there), and the code ported from ppy/osu and osu-framework stays under their MIT licence. osu! is a trademark of ppy Pty Ltd.
