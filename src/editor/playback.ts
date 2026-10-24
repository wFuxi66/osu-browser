// Global animation frame loop + hitsound/metronome scheduling during playback.
import { hitsounds, objectSoundEvents, type SoundEvent } from '../audio/hitsounds';
import { music } from '../audio/music';
import { redLineAt } from '../osu/timing';
import { editor } from './store';
import { storyboard } from './storyboard/runtime';

type FrameCallback = (time: number) => void;
const callbacks = new Set<FrameCallback>();

export function onFrame(cb: FrameCallback): () => void {
  callbacks.add(cb);
  return () => callbacks.delete(cb);
}

let events: SoundEvent[] = [];
let eventsRev = -1;
let eventsDiff = -1;
let eventsSbRev = -1;
let scheduledUpTo = -Infinity;
let wasPlaying = false;
let lastTime = 0;
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
  for (const s of samples) events.push({ time: s.time, play: (d) => hitsounds.playFile(s.file, s.volume / 100, d) });
  events.sort((a, b) => a.time - b.time);
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

function schedule(now: number) {
  if (!editor.hasProject) return;
  rebuildEvents();
  const playing = music.playing;
  if (!playing) {
    wasPlaying = false;
    return;
  }
  // Reset scheduling on start or seek.
  if (!wasPlaying || now < lastTime - 5 || now > lastTime + 500) scheduledUpTo = now - 1;
  wasPlaying = true;
  lastTime = now;
  const rate = music.rate;
  const until = now + LOOKAHEAD * rate;
  for (let i = firstIndexAfter(scheduledUpTo); i < events.length && events[i].time <= until; i++) {
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
    setTimeout(() => hitsounds.playMetronome(accent), delay * 1000);
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
  for (const cb of callbacks) {
    try {
      cb(t);
    } catch (e) {
      report(e);
    }
  }
}

function report(e: unknown) {
  const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  if (reported.has(msg)) return;
  reported.add(msg);
  console.error(e);
}

requestAnimationFrame(frame);
