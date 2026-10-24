# osu! web editor

An osu! (stable) style beatmap editor that runs in any modern browser. Drop an mp3 to start a new map, or open an `.osz` / beatmap folder to keep editing. When you're done, export the `.osz` (or a single `.osu`) and open it in osu!. Uploading to the osu! website isn't supported; use the real client for that.

Your work autosaves in the browser (IndexedDB). If you log in with your osu! account (optional), your WIP maps also sync to the server, so they're there when you open the editor on another computer.

## Running locally

Requires Node.js 22.18+ (Node 24 recommended).

```sh
npm install
cp .env.example .env     # optional: only needed for osu! login / cloud sync
npm run dev              # web on http://localhost:5173, API on :8787
```

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build` then `npm start` (serves the built app + API on one port).

### Enabling "Log in with osu!"

1. Go to <https://osu.ppy.sh/home/account/edit#oauth> → **New OAuth Application**.
2. Set the callback URL to `http://localhost:5173/api/auth/callback` (or `https://your-domain/api/auth/callback` in production).
3. Put the client id and secret in `.env` (`OSU_CLIENT_ID`, `OSU_CLIENT_SECRET`). In production also set `PUBLIC_URL` and `OSU_REDIRECT_URI` to your domain.

osu!'s OAuth needs a client secret for the token exchange, which is why there's a small backend. Without it, the editor still works fully offline/local.

### Deploying

`docker build -t osu-web-editor . && docker run -p 8787:8787 -v osu-editor-data:/data --env-file .env osu-web-editor`

Any host that runs a Node/Docker container with a persistent volume works (Fly.io, Railway, Render, a VPS). The SQLite database and uploaded `.osz` packages live in `DATA_DIR`.

### Opening published maps

The home screen accepts an `osu.ppy.sh/beatmapsets/…` link. The official API doesn't let third-party apps download beatmapsets, so the server fetches them from public mirrors (catboy.best, nerinyan, osu.direct).

## Feature checklist (vs. the stable editor)

**Files & projects**
- [x] New beatmap from mp3/ogg (reads ID3 artist/title/cover art)
- [x] Open `.osz`, a dropped beatmap folder, or loose `.osu` + assets
- [x] Open published maps by link (mirror proxy)
- [x] Save (Ctrl+S), autosave, revert to saved (Ctrl+L)
- [x] Export `.osz` package and single `.osu`
- [x] Multiple difficulties: create (copy timing / copy objects / any mode), switch (Ctrl+O), delete
- [x] Add files to the beatmap folder (custom hitsounds, images, storyboard assets), replace audio
- [x] Lossless round trip of `.osu` files (verified against ranked maps)
- [x] osu! OAuth login + per-account cloud sync

**Compose (F1)**
- [x] Select / circle / slider / spinner tools (1–4), mania note/hold tools
- [x] Slider placement with auto curve type (linear → perfect circle → bézier), red anchors, length snapped to beat divisor
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
- [x] Hitsound playback with default samples and beatmap custom samples (`soft-hitclap2.wav` etc.)
- [x] AiMod (Ctrl+Shift+A): unsnapped objects, overlaps, off-screen, missing files/metadata, breaks…
- [x] osu!taiko (don/kat/big, drumrolls, dendens), osu!mania (columns, notes, holds), osu!catch (std-style view)

**Timing (F3 / F6)**
- [x] Red and green lines (Ctrl+P / Ctrl+Shift+P), delete (Ctrl+I)
- [x] BPM, offset, meter, sample set, custom index, volume, kiai, omit first bar line
- [x] Tap tempo, offset/BPM nudging, metronome
- [x] Bookmarks, preview point, break periods (auto-generate)

**Song setup (F4)**
- [x] Metadata (unicode + romanised), difficulty sliders (HP/CS/AR/OD/key count, slider velocity, tick rate), audio settings, background & video, combo colours, slider border/track, countdown, letterbox, widescreen, epilepsy warning, stack leniency, mode

**Playback / navigation**
- [x] Play/pause/stop, 25/50/75/100% playback (pitch preserved), Ctrl+↑/↓ speed
- [x] Wheel seeking by beat snap, Shift 4x, Ctrl+wheel divisor, timing point / bookmark jumps, Z/X/C/V
- [x] Coloured beat snap ticks (1/1 … 1/16), timeline zoom, song overview with kiai/breaks/bookmarks
- [x] Test mode (F5): playable osu!standard with judgements and autoplay; preview for other modes

**Design (F2)**
- [x] Storyboard script editing (.osb and difficulty events), preserved on export
- [ ] Visual storyboard editor and storyboard playback preview
- [ ] Video playback in the editor background

## Credits

Default hitsound samples are from [ppy/osu-resources](https://github.com/ppy/osu-resources) (CC BY-NC 4.0). Slider maths follows osu-framework's `PathApproximator`. This project isn't affiliated with ppy.
