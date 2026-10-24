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
