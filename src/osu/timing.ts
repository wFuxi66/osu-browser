import type { Beatmap, Slider, TimingPoint } from './types';

const DEFAULT_TIMING: TimingPoint = {
  time: 0,
  beatLength: 500,
  meter: 4,
  sampleSet: 0,
  sampleIndex: 0,
  volume: 100,
  uninherited: true,
  kiai: false,
  omitFirstBarLine: false,
};

/** Ordering used everywhere: by time, uninherited before inherited at the same time. */
export function sortTimingPoints(tps: TimingPoint[]) {
  tps.sort((a, b) => a.time - b.time || (a.uninherited === b.uninherited ? 0 : a.uninherited ? -1 : 1));
}

export function uninheritedPoints(bm: Beatmap): TimingPoint[] {
  return bm.timingPoints.filter((t) => t.uninherited);
}

/** The red line in effect at `time` (the first one if `time` is before all of them). */
export function redLineAt(bm: Beatmap, time: number): TimingPoint {
  let found: TimingPoint | null = null;
  for (const tp of bm.timingPoints) {
    if (!tp.uninherited) continue;
    if (tp.time <= time + 0.5 || !found) found = tp;
    else break;
  }
  return found ?? DEFAULT_TIMING;
}

/** The last timing point of any kind at or before `time`; drives volume, sample set and kiai. */
export function controlPointAt(bm: Beatmap, time: number): TimingPoint {
  let found: TimingPoint | null = null;
  for (const tp of bm.timingPoints) {
    if (tp.time <= time + 0.5 || !found) found = tp;
    else break;
  }
  return found ?? DEFAULT_TIMING;
}

export function beatLengthAt(bm: Beatmap, time: number): number {
  return redLineAt(bm, time).beatLength;
}

/** Slider velocity multiplier from green lines. */
export function svAt(bm: Beatmap, time: number): number {
  let sv = 1;
  for (const tp of bm.timingPoints) {
    if (tp.time > time + 0.5) break;
    if (tp.uninherited) sv = 1;
    else if (tp.beatLength < 0) sv = Math.min(10, Math.max(0.1, -100 / tp.beatLength));
    else sv = 1;
  }
  return sv;
}

export function bpmOf(tp: TimingPoint): number {
  return 60000 / tp.beatLength;
}

/** osu!pixels per beat at a given time. */
export function pixelsPerBeat(bm: Beatmap, time: number): number {
  return bm.difficulty.sliderMultiplier * 100 * svAt(bm, time);
}

/** Duration of one slider span (head to tail) in ms. */
export function sliderSpanDuration(bm: Beatmap, s: Slider): number {
  const ppb = pixelsPerBeat(bm, s.time);
  if (ppb <= 0) return 0;
  return (s.length / ppb) * beatLengthAt(bm, s.time);
}

export function sliderDuration(bm: Beatmap, s: Slider): number {
  return sliderSpanDuration(bm, s) * s.slides;
}

export function objectEndTime(bm: Beatmap, o: Beatmap['hitObjects'][number]): number {
  switch (o.kind) {
    case 'circle':
      return o.time;
    case 'slider':
      return o.time + sliderDuration(bm, o);
    default:
      return o.endTime;
  }
}

/** Snap `time` to the nearest tick of the given divisor relative to its red line. */
export function snapTime(bm: Beatmap, time: number, divisor: number): number {
  const red = redLineAt(bm, time);
  const step = red.beatLength / divisor;
  if (!(step > 0)) return time;
  let snapped = red.time + Math.round((time - red.time) / step) * step;
  // Don't snap past the next red line.
  const next = bm.timingPoints.find((t) => t.uninherited && t.time > red.time);
  if (next && snapped > next.time) snapped = next.time;
  return snapped;
}

/** The next/previous divisor tick from `time`. */
export function stepTick(bm: Beatmap, time: number, divisor: number, direction: 1 | -1): number {
  const red = redLineAt(bm, time + direction);
  const step = red.beatLength / divisor;
  if (!(step > 0)) return time + direction * 100;
  const idx = (time - red.time) / step;
  const k = direction > 0 ? Math.floor(idx + 1e-4) + 1 : Math.ceil(idx - 1e-4) - 1;
  let t = red.time + k * step;
  if (direction > 0) {
    const next = bm.timingPoints.find((tp) => tp.uninherited && tp.time > time + 1);
    if (next && t > next.time) t = next.time;
  } else {
    const cur = redLineAt(bm, time);
    if (cur.time < time - 1 && t < cur.time) t = cur.time;
  }
  return t;
}

/**
 * Which divisor a tick belongs to (1, 2, 3, 4, 6, 8, 12, 16...), used for timeline tick colours.
 * `index` is the tick index at `divisor` resolution.
 */
export function tickDivisorOf(index: number, divisor: number): number {
  for (const d of [1, 2, 3, 4, 6, 8, 12, 16]) {
    if (divisor % d !== 0) continue;
    if ((index * d) % divisor === 0) return d;
  }
  return divisor;
}

export function tickColour(d: number): string {
  switch (d) {
    case 1: return '#ffffff';
    case 2: return '#ff3030';
    case 3: return '#b040ff';
    case 4: return '#3c8cff';
    case 6: return '#d080ff';
    case 8: return '#ffd23c';
    case 12: return '#a0a0a0';
    default: return '#707070';
  }
}

export const BEAT_DIVISORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16];

/** Is `time` within ~1ms of a tick at `divisor`? */
export function isSnapped(bm: Beatmap, time: number, divisor: number): boolean {
  const s = snapTime(bm, time, divisor);
  return Math.abs(s - time) <= 1.5;
}

/** Smallest standard divisor this time is snapped to, or 0 if unsnapped. */
export function snapDivisorOf(bm: Beatmap, time: number): number {
  for (const d of [1, 2, 4, 8, 16, 3, 6, 12, 5, 7, 9]) if (isSnapped(bm, time, d)) return d;
  return 0;
}
