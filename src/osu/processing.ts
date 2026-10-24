// Derived per-object data: combo numbers/colours, stacking and end positions.
import { dist, getSliderPath, sliderEndPosition } from './curves';
import { objectEndTime, sliderSpanDuration, svAt } from './timing';
import type { Beatmap, HitObject, Slider, Vec2 } from './types';

export function circleRadius(cs: number): number {
  return 54.4 - 4.48 * cs;
}

export function preemptTime(ar: number): number {
  return ar < 5 ? 1200 + (600 * (5 - ar)) / 5 : 1200 - (750 * (ar - 5)) / 5;
}

export function fadeInTime(ar: number): number {
  return ar < 5 ? 800 + (400 * (5 - ar)) / 5 : 800 - (500 * (ar - 5)) / 5;
}

/** Hit windows in ms (±) for 300/100/50 judgements. */
export function hitWindows(od: number) {
  return { great: 80 - 6 * od, ok: 140 - 8 * od, meh: 200 - 10 * od };
}

export interface ObjectInfo {
  comboNumber: number;
  comboIndex: number;
  stackHeight: number;
  endTime: number;
  endPos: Vec2;
}

export interface ProcessedBeatmap {
  info: Map<number, ObjectInfo>;
  radius: number;
  preempt: number;
  fadeIn: number;
  stackOffset: number;
}

const STACK_DISTANCE = 3;

export function processBeatmap(bm: Beatmap): ProcessedBeatmap {
  const objs = bm.hitObjects;
  const info = new Map<number, ObjectInfo>();
  const radius = circleRadius(bm.difficulty.circleSize);
  const preempt = preemptTime(bm.difficulty.approachRate);
  const fadeIn = fadeInTime(bm.difficulty.approachRate);

  // Matches osu!: spinners never start a combo; the first object and the one after a spinner always do.
  // The colour index starts at 1, so the first combo uses the second combo colour, as in stable.
  let comboIndex = 0;
  let comboNumber = 0;
  objs.forEach((o, i) => {
    const prev = objs[i - 1];
    if (o.kind !== 'spinner' && (i === 0 || o.newCombo || prev.kind === 'spinner')) {
      comboIndex += 1 + o.comboSkip;
      comboNumber = 0;
    }
    if (o.kind !== 'spinner') comboNumber++;
    const endPos = o.kind === 'slider' ? sliderEndPosition(o) : { x: o.x, y: o.y };
    info.set(o.id, { comboNumber: o.kind === 'spinner' ? 0 : comboNumber, comboIndex, stackHeight: 0, endTime: objectEndTime(bm, o), endPos });
  });

  if (bm.general.mode === 0) applyStacking(bm, objs, info, preempt);
  const scale = (1 - (0.7 * (bm.difficulty.circleSize - 5)) / 5) / 2;
  return { info, radius, preempt, fadeIn, stackOffset: -6.4 * scale };
}

function applyStacking(bm: Beatmap, objs: HitObject[], info: Map<number, ObjectInfo>, preempt: number) {
  const threshold = preempt * bm.general.stackLeniency;
  const pos = (o: HitObject): Vec2 => ({ x: o.x, y: o.y });
  const inf = (o: HitObject) => info.get(o.id)!;
  const count = objs.length;
  if (count === 0) return;

  // Reverse pass, following osu!'s stacking algorithm for format v6+.
  for (let i = count - 1; i > 0; i--) {
    let n = i;
    let objI = objs[i];
    if (inf(objI).stackHeight !== 0 || objI.kind === 'spinner') continue;
    if (objI.kind === 'circle') {
      while (--n >= 0) {
        const objN = objs[n];
        if (objN.kind === 'spinner') continue;
        if (objI.time - inf(objN).endTime > threshold) break;
        if (objN.kind === 'slider' && dist(inf(objN).endPos, pos(objI)) < STACK_DISTANCE) {
          const offset = inf(objI).stackHeight - inf(objN).stackHeight + 1;
          for (let j = n + 1; j <= i; j++) {
            const objJ = objs[j];
            if (dist(inf(objN).endPos, pos(objJ)) < STACK_DISTANCE) inf(objJ).stackHeight -= offset;
          }
          break;
        }
        if (dist(pos(objN), pos(objI)) < STACK_DISTANCE) {
          inf(objN).stackHeight = inf(objI).stackHeight + 1;
          objI = objN;
        }
      }
    } else if (objI.kind === 'slider') {
      while (--n >= 0) {
        const objN = objs[n];
        if (objN.kind === 'spinner') continue;
        if (objI.time - objN.time > threshold) break;
        if (dist(inf(objN).endPos, pos(objI)) < STACK_DISTANCE) {
          inf(objN).stackHeight = inf(objI).stackHeight + 1;
          objI = objN;
        }
      }
    }
  }
}

/** Visible (stacked) position of an object's head. */
export function stackedPosition(o: HitObject, p: ProcessedBeatmap): Vec2 {
  const h = p.info.get(o.id)?.stackHeight ?? 0;
  return { x: o.x + h * p.stackOffset, y: o.y + h * p.stackOffset };
}

/** Index into a combo colour palette of `count` colours (the beatmap's, or the skin's when it has none). */
export function comboColourIndex(o: HitObject, p: ProcessedBeatmap, count: number): number {
  return (p.info.get(o.id)?.comboIndex ?? 0) % Math.max(1, count);
}

/** Slider tick positions within one span, as progress values in (0, 1). */
export function sliderTickProgresses(bm: Beatmap, o: Slider): number[] {
  const path = getSliderPath(o);
  const spanDuration = sliderSpanDuration(bm, o);
  if (path.length <= 0 || spanDuration <= 0) return [];
  const tickRate = bm.difficulty.sliderTickRate || 1;
  const tickDistance = (bm.difficulty.sliderMultiplier * 100 * svAt(bm, o.time)) / tickRate;
  const velocity = path.length / spanDuration;
  const minFromEnd = velocity * 10;
  const out: number[] = [];
  if (tickDistance <= 0) return out;
  for (let d = tickDistance; d < path.length - minFromEnd && out.length < 1000; d += tickDistance) out.push(d / path.length);
  return out;
}
