// osu!catch object model on top of the shared hit objects: fruits/droplets/bananas generated from
// circles/sliders/spinners, hyperdash detection, and juice stream construction from (time, x) vertices.
import { getSliderPath } from './curves';
import { sliderTickProgresses } from './processing';
import { sliderSpanDuration, svAt, beatLengthAt } from './timing';
import type { Beatmap, HitObject, Slider, Vec2 } from './types';

export const CATCH_WIDTH = 512;
const CATCHER_BASE_SIZE = 106.75;
const BASE_DASH_SPEED = 1.0;

export type CatchKind = 'fruit' | 'droplet' | 'tiny' | 'banana';

export interface CatchObject {
  time: number;
  x: number;
  kind: CatchKind;
  parent: HitObject;
  /** Index of the edge (head/repeat/tail) for fruits inside a juice stream. */
  edge?: number;
  hyper?: boolean;
}

/** Fruit display scale (like lazer: half of the legacy circle-size scale). */
export function catchObjectScale(cs: number): number {
  return (1 - (0.7 * (cs - 5)) / 5) / 2;
}

/** Radius (osu!px) a fruit is drawn with. */
export function fruitRadius(cs: number): number {
  return 64 * catchObjectScale(cs);
}

/** Width of the catcher plate (osu!px), as used by stable's hyperdash calculation. */
export function catcherWidth(cs: number): number {
  return CATCHER_BASE_SIZE * Math.abs(1 - (0.7 * (cs - 5)) / 5);
}

const clampX = (x: number) => Math.max(0, Math.min(CATCH_WIDTH, x));

/** Every catchable/visible object, sorted by time. */
export function catchObjects(bm: Beatmap): CatchObject[] {
  const out: CatchObject[] = [];
  for (const o of bm.hitObjects) {
    if (o.kind === 'circle') out.push({ time: o.time, x: clampX(o.x), kind: 'fruit', parent: o });
    else if (o.kind === 'slider') out.push(...juiceStreamObjects(bm, o));
    else if (o.kind === 'spinner') out.push(...bananaShower(o));
  }
  return out.sort((a, b) => a.time - b.time);
}

export function juiceStreamObjects(bm: Beatmap, s: Slider): CatchObject[] {
  const path = getSliderPath(s);
  const span = sliderSpanDuration(bm, s);
  if (!(span > 0) || path.length <= 0) return [{ time: s.time, x: clampX(s.x), kind: 'fruit', parent: s, edge: 0 }];
  const ticks = sliderTickProgresses(bm, s);
  const posAt = (p: number) => clampX(path.positionAt(p).x);
  // Major events: fruits on every edge, droplets on ticks.
  const events: CatchObject[] = [];
  for (let i = 0; i < s.slides; i++) {
    const start = s.time + span * i;
    events.push({ time: start, x: posAt(i % 2 === 0 ? 0 : 1), kind: 'fruit', parent: s, edge: i });
    // Tick progress p is along the path from the head; reversed spans reach it at 1 - p of the span.
    for (const p of ticks) events.push({ time: start + span * (i % 2 === 0 ? p : 1 - p), x: posAt(p), kind: 'droplet', parent: s });
  }
  events.push({ time: s.time + span * s.slides, x: posAt(s.slides % 2 === 0 ? 0 : 1), kind: 'fruit', parent: s, edge: s.slides });
  events.sort((a, b) => a.time - b.time);
  // Tiny droplets fill the gaps at (at most) 100ms intervals derived from the tick spacing.
  let interval = ticks.length ? span * ticks[0] : span;
  while (interval > 100) interval /= 2;
  const out: CatchObject[] = [];
  for (let i = 0; i < events.length; i++) {
    out.push(events[i]);
    const next = events[i + 1];
    if (!next || interval <= 0) continue;
    for (let t = events[i].time + interval; t < next.time - 1; t += interval) {
      const local = (t - s.time) / span;
      const spanIndex = Math.floor(local);
      const frac = local - spanIndex;
      out.push({ time: t, x: posAt(spanIndex % 2 === 0 ? frac : 1 - frac), kind: 'tiny', parent: s });
    }
  }
  return out;
}

/** Bananas every 60ms or so across the spinner, at deterministic pseudo-random positions. */
export function bananaShower(o: Extract<HitObject, { kind: 'spinner' }>): CatchObject[] {
  const out: CatchObject[] = [];
  const dur = o.endTime - o.time;
  if (dur <= 0) return out;
  let spacing = dur;
  while (spacing > 100) spacing /= 2;
  let seed = 1337 + Math.round(o.time);
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let t = o.time; t <= o.endTime + 0.5; t += spacing) out.push({ time: t, x: rand() * CATCH_WIDTH, kind: 'banana', parent: o });
  return out;
}

/** Marks fruits/droplets that need a hyperdash to reach the next one (stable's algorithm). */
export function markHyperdashes(objects: CatchObject[], cs: number) {
  const palpable = objects.filter((o) => o.kind === 'fruit' || o.kind === 'droplet');
  const half = catcherWidth(cs) / 2;
  let lastDirection = 0;
  let lastExcess = half;
  for (let i = 0; i < palpable.length - 1; i++) {
    const cur = palpable[i];
    const next = palpable[i + 1];
    cur.hyper = false;
    const direction = next.x > cur.x ? 1 : -1;
    const timeToNext = next.time - cur.time - 1000 / 60 / 4;
    const distanceToNext = Math.abs(next.x - cur.x) - (lastDirection === direction ? lastExcess : half);
    const distanceToHyper = timeToNext * BASE_DASH_SPEED - distanceToNext;
    if (distanceToHyper < 0) {
      cur.hyper = true;
      lastExcess = half;
    } else {
      lastExcess = Math.max(0, Math.min(half, distanceToHyper));
    }
    lastDirection = direction;
  }
}

/** Juice stream speed in osu!px per ms at a time. */
export function sliderVelocity(bm: Beatmap, time: number): number {
  return (bm.difficulty.sliderMultiplier * 100 * svAt(bm, time)) / beatLengthAt(bm, time);
}

/**
 * Build a slider path from (time, x) vertices the way lazer's juice stream editor does: the path's length
 * between vertices equals the distance travelled in that time, with the horizontal part limited to it.
 */
export function juiceStreamPath(vertices: { time: number; x: number }[], velocity: number, startY = 384): { head: Vec2; points: Vec2[]; length: number } {
  const head = { x: Math.round(clampX(vertices[0].x)), y: startY };
  const points: Vec2[] = [];
  let x = head.x;
  let y = head.y;
  let length = 0;
  for (let i = 1; i < vertices.length; i++) {
    const dd = Math.max(0, (vertices[i].time - vertices[i - 1].time) * velocity);
    const dx = Math.max(-dd, Math.min(dd, clampX(vertices[i].x) - x));
    x += dx;
    y -= Math.sqrt(Math.max(0, dd * dd - dx * dx));
    length += dd;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return { head, points, length };
}
