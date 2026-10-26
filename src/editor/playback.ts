// Global animation frame loop + hitsound/metronome scheduling during playback.
import { hitsounds, objectSoundEvents, objectSustainedSounds, type SoundEvent, type SustainedSound } from '../audio/hitsounds';
import { music } from '../audio/music';
import { redLineAt } from '../osu/timing';
import { editor } from './store';
import { storyboard } from './storyboard/runtime';

type FrameCallback = (time: number) => void;
const callbacks = new Set<FrameCallback>();
const everyFrame = new Set<FrameCallback>();

/**
 * Calls `cb` with the song time on animation frames. The editor's views draw only what time, the store and input
 * decide, so while nothing changes their frames are skipped (see `stillFrame`); `always` callbacks (gameplay, which
 * animates on its own) run every frame.
 */
export function onFrame(cb: FrameCallback, opts: { always?: boolean } = {}): () => void {
  const set = opts.always ? everyFrame : callbacks;
  set.add(cb);
  return () => set.delete(cb);
}

/** Even when nothing seems to change, redraw this often: images, videos and skins finish loading on their own. */
const IDLE_REDRAW_MS = 250;
let inputRev = 0;
const bumpInput = () => void inputRev++;
// Input moves cursors, previews and hovers that the store doesn't track.
for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup', 'resize', 'blur'] as const) {
  window.addEventListener(type, bumpInput, { capture: true, passive: true });
}
music.onChange(bumpInput);

/** Draws the next frame even if nothing seems to have changed: a resized canvas comes back blank. */
export const redrawNext = bumpInput;

const drawn = { time: NaN, rev: -1, input: -1, at: -Infinity };

/** Whether the editor's views would draw the same frame as last time. */
function stillFrame(shown: number): boolean {
  const now = performance.now();
  if (!music.playing && shown === drawn.time && editor.rev === drawn.rev && inputRev === drawn.input && now - drawn.at < IDLE_REDRAW_MS) return true;
  drawn.time = shown;
  drawn.rev = editor.rev;
  drawn.input = inputRev;
  drawn.at = now;
  return false;
}

/**
 * While someone plays the map (not autoplay), hitsounds follow their hits, so the objects' sounds aren't scheduled
 * here; storyboard samples still are.
 */
export const scheduling = { manualHitsounds: false };

let events: (SoundEvent & { storyboard?: boolean })[] = [];
let sustains: SustainedSound[] = [];
let eventsRev = -1;
let eventsDiff = -1;
let eventsSbRev = -1;
let scheduledUpTo = -Infinity;
let wasPlaying = false;
let lastTime = 0;
let lastRate = 1;
const LOOKAHEAD = 60;

function rebuildEvents() {
  const samples = editor.prefs.showStoryboard ? storyboard.samples() : [];
  const sbRev = editor.prefs.showStoryboard ? storyboard.rev : -2;
  if (eventsRev === editor.contentRev && eventsDiff === editor.diffIndex && eventsSbRev === sbRev) return;
  eventsRev = editor.contentRev;
  eventsDiff = editor.diffIndex;
  eventsSbRev = sbRev;
  const bm = editor.bm;
  events = bm.hitObjects.flatMap((o) => objectSoundEvents(bm, o));
  for (const s of samples) events.push({ time: s.time, storyboard: true, play: (d) => hitsounds.playFile(s.file, s.volume / 100, d) });
  events.sort((a, b) => a.time - b.time);
  sustains = bm.hitObjects.flatMap((o) => objectSustainedSounds(bm, o)).sort((a, b) => a.start - b.start);
}

function firstIndexAfter(t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function firstSustainAfter(t: number): number {
  let lo = 0;
  let hi = sustains.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sustains[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function schedule(now: number) {
  if (!editor.hasProject) return;
  rebuildEvents();
  const playing = music.playing;
  if (!playing) {
    if (wasPlaying) hitsounds.stopLoops();
    wasPlaying = false;
    return;
  }
  const rate = music.rate;
  // Reset scheduling on start, seek or rate change; loops already running are restarted from here.
  if (!wasPlaying || now < lastTime - 5 || now > lastTime + 500 || rate !== lastRate) {
    scheduledUpTo = now - 1;
    hitsounds.stopLoops();
    for (const s of scheduling.manualHitsounds ? [] : sustains) {
      if (s.start > scheduledUpTo) break;
      if (now < s.end - 20) s.play(0, now - s.start, rate);
    }
  }
  wasPlaying = true;
  lastTime = now;
  lastRate = rate;
  const until = now + LOOKAHEAD * rate;
  const manual = scheduling.manualHitsounds;
  for (let i = firstSustainAfter(scheduledUpTo); !manual && i < sustains.length && sustains[i].start <= until; i++) {
    sustains[i].play(Math.max(0, (sustains[i].start - now) / rate / 1000), 0, rate);
  }
  for (let i = firstIndexAfter(scheduledUpTo); i < events.length && events[i].time <= until; i++) {
    if (manual && !events[i].storyboard) continue;
    const delay = Math.max(0, (events[i].time - now) / rate / 1000);
    events[i].play(delay);
  }
  if (editor.metronome) scheduleMetronome(scheduledUpTo, until, now, rate);
  scheduledUpTo = until;
}

function scheduleMetronome(from: number, to: number, now: number, rate: number) {
  const bm = editor.bm;
  const red = redLineAt(bm, to);
  if (!(red.beatLength > 0)) return;
  const first = Math.ceil((from - red.time) / red.beatLength + 1e-6);
  for (let k = first; red.time + k * red.beatLength <= to; k++) {
    const t = red.time + k * red.beatLength;
    const delay = Math.max(0, (t - now) / rate / 1000);
    const accent = ((k % red.meter) + red.meter) % red.meter === 0;
    hitsounds.playMetronome(accent, delay);
  }
}

const reported = new Set<string>();

function frame() {
  requestAnimationFrame(frame);
  const t = music.time;
  // One failing renderer must not stop the others (or playback scheduling).
  try {
    schedule(t);
  } catch (e) {
    report(e);
  }
  const shown = music.displayTime;
  const run = (cb: FrameCallback) => {
    try {
      cb(shown);
    } catch (e) {
      report(e);
    }
  };
  everyFrame.forEach(run);
  if (!stillFrame(shown)) callbacks.forEach(run);
}

function report(e: unknown) {
  const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  if (reported.has(msg)) return;
  reported.add(msg);
  console.error(e);
}

requestAnimationFrame(frame);
