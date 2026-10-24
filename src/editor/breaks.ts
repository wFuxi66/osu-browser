import { preemptTime } from '../osu/processing';
import { objectEndTime } from '../osu/timing';
import type { Beatmap, BreakPeriod } from '../osu/types';

const MIN_GAP = 5000;
const GAP_BEFORE = 200;
const MIN_BREAK = 650;

/** Break periods for every gap of 5s or more between objects. */
export function autoBreaks(bm: Beatmap): BreakPeriod[] {
  const out: BreakPeriod[] = [];
  const objs = bm.hitObjects;
  const after = Math.max(450, preemptTime(bm.difficulty.approachRate));
  let prevEnd = -Infinity;
  for (const o of objs) {
    if (Number.isFinite(prevEnd) && o.time - prevEnd >= MIN_GAP) {
      const start = Math.round(prevEnd + GAP_BEFORE);
      const end = Math.round(o.time - after);
      if (end - start >= MIN_BREAK) out.push({ start, end });
    }
    prevEnd = Math.max(prevEnd, objectEndTime(bm, o));
  }
  return out;
}

/** Insert Break Time: a break filling the gap around `time` between the surrounding objects, or null if it doesn't fit. */
export function breakAt(bm: Beatmap, time: number): BreakPeriod | null {
  const after = Math.max(450, preemptTime(bm.difficulty.approachRate));
  let prevEnd = -Infinity;
  let next = Infinity;
  for (const o of bm.hitObjects) {
    const end = objectEndTime(bm, o);
    if (end <= time) prevEnd = Math.max(prevEnd, end);
    else if (o.time >= time) next = Math.min(next, o.time);
    else return null; // inside an object
  }
  if (!Number.isFinite(prevEnd) || !Number.isFinite(next)) return null;
  const start = Math.round(prevEnd + GAP_BEFORE);
  const end = Math.round(next - after);
  return end - start >= MIN_BREAK ? { start, end } : null;
}
