// Converts our Beatmap into lazer's playable osu! objects: legacy decoding rules, control point lookups,
// slider nested objects (SliderEventGenerator) and stacking (OsuBeatmapProcessor).
import type { Beatmap, HitObject } from '../types';
import { almostEquals, FIRST_LAZER_VERSION, LazerSliderPath, legacyControlPoints, type PathType } from './path';
import { add, distance, f32, vec, type V2 } from './vec';

export const TAIL_LENIENCY = -36;
const EARLY_VERSION_TIMING_OFFSET = 24;
const STACK_DISTANCE = 3;
const OBJECT_RADIUS = 64;

export interface NestedObject {
  kind: 'head' | 'tick' | 'repeat' | 'tail';
  startTime: number;
  position: V2;
  stackedPosition: V2;
}

export interface OsuObject {
  kind: 'circle' | 'slider' | 'spinner';
  startTime: number;
  endTime: number;
  position: V2;
  endPosition: V2;
  stackHeight: number;
  stackedPosition: V2;
  stackedEndPosition: V2;
  // Sliders only.
  path: LazerSliderPath | null;
  repeatCount: number;
  spanDuration: number;
  velocity: number;
  nested: NestedObject[];
}

export interface DifficultySettings {
  /** All float32, as in lazer's BeatmapDifficulty. */
  circleSize: number;
  approachRate: number;
  overallDifficulty: number;
  drainRate: number;
  sliderMultiplier: number;
  sliderTickRate: number;
}

export interface ControlPoints {
  timing: { time: number; beatLength: number }[];
  difficulty: { time: number; sliderVelocity: number; generateTicks: boolean }[];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function difficultyRange(d: number, min: number, mid: number, max: number): number {
  if (d > 5) return mid + (max - mid) * ((d - 5) / 5);
  if (d < 5) return mid + (mid - min) * ((d - 5) / 5);
  return mid;
}

/** Time offset lazer applies to every timestamp of very old (v4 and lower) beatmaps. */
export const timeOffset = (bm: Beatmap) => (bm.formatVersion < 5 ? EARLY_VERSION_TIMING_OFFSET : 0);

export function difficultySettings(bm: Beatmap): DifficultySettings {
  const d = bm.difficulty;
  const mania = bm.general.mode === 3;
  return {
    drainRate: f32(clamp(d.hpDrainRate, 0, 10)),
    circleSize: f32(mania ? clamp(d.circleSize, 1, 18) : clamp(d.circleSize, 0, 10)),
    overallDifficulty: f32(clamp(d.overallDifficulty, 0, 10)),
    approachRate: f32(clamp(d.approachRate, 0, 10)),
    sliderMultiplier: clamp(d.sliderMultiplier, 0.4, 3.6),
    sliderTickRate: clamp(d.sliderTickRate, 0.5, 8),
  };
}

/** Timing and difficulty control points the way LegacyBeatmapDecoder builds them. */
export function controlPoints(bm: Beatmap): ControlPoints {
  const offset = timeOffset(bm);
  const timing: ControlPoints['timing'] = [];
  const difficulty: ControlPoints['difficulty'] = [];
  // Our parser keeps red lines before green lines at the same time. At one time, the first red line and the last
  // green line win (lazer's pending-point flush).
  for (const tp of bm.timingPoints) {
    const time = tp.time + offset;
    const speed = tp.beatLength < 0 ? 100 / -tp.beatLength : 1;
    const dp = { time, sliderVelocity: clamp(speed, 0.1, 10), generateTicks: !Number.isNaN(tp.beatLength) };
    if (tp.uninherited) {
      const last = timing[timing.length - 1];
      if (!last || last.time !== time) timing.push({ time, beatLength: clamp(tp.beatLength, 6, 60000) });
    }
    const lastD = difficulty[difficulty.length - 1];
    if (lastD && lastD.time === time) {
      if (!tp.uninherited) difficulty[difficulty.length - 1] = dp;
    } else difficulty.push(dp);
  }
  return { timing, difficulty };
}

function lastAtOrBefore<T extends { time: number }>(list: T[], time: number): T | null {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? list[found] : null;
}

export function timingPointAt(cp: ControlPoints, time: number) {
  return lastAtOrBefore(cp.timing, time) ?? cp.timing[0] ?? { time: 0, beatLength: 1000 };
}

export function difficultyPointAt(cp: ControlPoints, time: number) {
  return lastAtOrBefore(cp.difficulty, time) ?? { time: 0, sliderVelocity: 1, generateTicks: true };
}

/** LegacyRulesetExtensions.GetPrecisionAdjustedBeatLength. */
export function precisionAdjustedBeatLength(sliderVelocity: number, beatLength: number, maniaOrTaiko: boolean): number {
  const svAsBeatLength = -100 / sliderVelocity;
  const bpmMultiplier = svAsBeatLength < 0 ? clamp(f32(-svAsBeatLength), 10, maniaOrTaiko ? 10000 : 1000) / 100.0 : 1;
  return beatLength * bpmMultiplier;
}

export interface SliderEvent {
  kind: 'head' | 'tick' | 'repeat' | 'legacyLastTick' | 'tail';
  time: number;
  spanIndex: number;
  pathProgress: number;
}

/** SliderEventGenerator.Generate. */
export function sliderEvents(startTime: number, spanDuration: number, velocity: number, tickDistance: number, totalDistance: number, spanCount: number): SliderEvent[] {
  const out: SliderEvent[] = [];
  const len = Math.min(100000, totalDistance);
  tickDistance = clamp(tickDistance, 0, len);
  const minDistanceFromEnd = velocity * 10;
  out.push({ kind: 'head', time: startTime, spanIndex: 0, pathProgress: 0 });
  for (let span = 0; span < spanCount; span++) {
    const spanStartTime = startTime + span * spanDuration;
    const reversed = span % 2 === 1;
    if (tickDistance !== 0) {
      const ticks: SliderEvent[] = [];
      for (let d = tickDistance; d <= len; d += tickDistance) {
        if (d >= len - minDistanceFromEnd) break;
        const pathProgress = d / len;
        const timeProgress = reversed ? 1 - pathProgress : pathProgress;
        ticks.push({ kind: 'tick', time: spanStartTime + timeProgress * spanDuration, spanIndex: span, pathProgress });
      }
      if (reversed) ticks.reverse();
      out.push(...ticks);
    }
    if (span < spanCount - 1) out.push({ kind: 'repeat', time: spanStartTime + spanDuration, spanIndex: span, pathProgress: (span + 1) % 2 });
  }
  const totalDuration = spanCount * spanDuration;
  const finalSpanIndex = spanCount - 1;
  const finalSpanStartTime = startTime + finalSpanIndex * spanDuration;
  const legacyLastTickTime = Math.max(startTime + totalDuration / 2, finalSpanStartTime + spanDuration + TAIL_LENIENCY);
  let legacyLastTickProgress = (legacyLastTickTime - finalSpanStartTime) / spanDuration;
  if (spanCount % 2 === 0) legacyLastTickProgress = 1 - legacyLastTickProgress;
  out.push({ kind: 'legacyLastTick', time: legacyLastTickTime, spanIndex: finalSpanIndex, pathProgress: legacyLastTickProgress });
  out.push({ kind: 'tail', time: startTime + totalDuration, spanIndex: finalSpanIndex, pathProgress: spanCount % 2 });
  return out;
}

/** Head-relative path and expected length of a legacy slider, as lazer decodes them. */
export function legacySliderPath(o: Extract<HitObject, { kind: 'slider' }>, formatVersion: number, head: V2, optimiseCatmull = true): LazerSliderPath {
  const lazerFormat = formatVersion >= FIRST_LAZER_VERSION;
  const coord = (n: number) => f32(lazerFormat ? n : Math.trunc(n));
  const points = o.points.map((p) => vec(f32(coord(p.x) - head.x), f32(coord(p.y) - head.y)));
  const cps = legacyControlPoints(o.curveType as PathType, points, formatVersion);
  const length = Math.max(0, o.length);
  return new LazerSliderPath(cps, length === 0 ? null : length, optimiseCatmull);
}

export function legacyPosition(o: HitObject, formatVersion: number): V2 {
  return formatVersion >= FIRST_LAZER_VERSION ? vec(o.x, o.y) : vec(Math.trunc(o.x), Math.trunc(o.y));
}

export interface OsuBeatmap {
  objects: OsuObject[];
  scale: number;
  radius: number;
  preempt: number;
  fadeIn: number;
  /** ± window for a 300, in ms. */
  greatWindow: number;
  difficulty: DifficultySettings;
}

/** CalculateScaleFromCircleSize(cs, applyFudge: true). */
export function circleScale(cs: number): number {
  return f32(f32(f32(1 - f32(0.7) * ((cs - 5) / 5)) / 2) * f32(1.00041));
}

export function convertOsu(bm: Beatmap): OsuBeatmap {
  const diff = difficultySettings(bm);
  const cp = controlPoints(bm);
  const offset = timeOffset(bm);
  const objScale = circleScale(diff.circleSize);
  const preempt = Math.trunc(difficultyRange(diff.approachRate, 1800, 1200, 450));
  const fadeIn = 400 * Math.min(1, preempt / 450);
  const greatWindow = Math.floor(difficultyRange(diff.overallDifficulty, 80, 50, 20)) - 0.5;
  const stackOffsetUnit = f32(objScale * f32(-6.4));

  const objects: OsuObject[] = [];
  for (const o of bm.hitObjects) {
    const startTime = o.time + offset;
    if (o.kind === 'spinner' || o.kind === 'hold') {
      const position = vec(256, 192);
      const endTime = startTime + Math.max(0, o.endTime + offset - startTime);
      objects.push(baseObject('spinner', startTime, endTime, position, position));
      continue;
    }
    const position = legacyPosition(o, bm.formatVersion);
    if (o.kind === 'circle') {
      objects.push(baseObject('circle', startTime, startTime, position, position));
      continue;
    }
    const path = legacySliderPath(o, bm.formatVersion, position);
    const repeatCount = almostEquals(path.distance, 0) ? 0 : Math.max(0, o.slides - 1);
    const spanCount = repeatCount + 1;
    const dp = difficultyPointAt(cp, startTime);
    const tp = timingPointAt(cp, startTime);
    const velocity = (100 * diff.sliderMultiplier) / precisionAdjustedBeatLength(dp.sliderVelocity, tp.beatLength, false);
    const scoringDistance = velocity * tp.beatLength;
    const tickDistanceMultiplier = bm.formatVersion < 8 ? 1 / dp.sliderVelocity : 1;
    const tickDistance = dp.generateTicks ? (scoringDistance / diff.sliderTickRate) * tickDistanceMultiplier : Infinity;
    const endTime = startTime + (spanCount * path.distance) / velocity;
    const spanDuration = (endTime - startTime) / spanCount;
    const endPosition = add(position, path.positionAt(spanCount % 2 === 0 ? 0 : 1));
    const slider = baseObject('slider', startTime, endTime, position, endPosition);
    slider.path = path;
    slider.repeatCount = repeatCount;
    slider.spanDuration = spanDuration;
    slider.velocity = velocity;
    for (const e of sliderEvents(startTime, spanDuration, velocity, tickDistance, path.distance, spanCount)) {
      switch (e.kind) {
        case 'head':
          slider.nested.push(nested('head', e.time, position));
          break;
        case 'tick':
          slider.nested.push(nested('tick', e.time, add(position, path.positionAt(e.pathProgress))));
          break;
        case 'repeat':
          slider.nested.push(nested('repeat', startTime + (e.spanIndex + 1) * spanDuration, add(position, path.positionAt(e.pathProgress))));
          break;
        case 'tail':
          slider.nested.push(nested('tail', e.time, endPosition));
          break;
      }
    }
    slider.nested.sort((a, b) => a.startTime - b.startTime);
    objects.push(slider);
  }
  // The decoder sorts objects by start time (stable).
  objects.sort((a, b) => a.startTime - b.startTime);

  applyStacking(objects, bm.formatVersion, f32(preempt * f32(bm.general.stackLeniency)));
  for (const o of objects) {
    const off = f32(o.stackHeight * stackOffsetUnit);
    const offV = { x: off, y: off };
    o.stackedPosition = add(o.position, offV);
    o.stackedEndPosition = add(o.endPosition, offV);
    for (const n of o.nested) n.stackedPosition = add(n.position, offV);
  }

  return { objects, scale: objScale, radius: OBJECT_RADIUS * objScale, preempt, fadeIn, greatWindow, difficulty: diff };
}

function baseObject(kind: OsuObject['kind'], startTime: number, endTime: number, position: V2, endPosition: V2): OsuObject {
  return {
    kind,
    startTime,
    endTime,
    position,
    endPosition,
    stackHeight: 0,
    stackedPosition: position,
    stackedEndPosition: endPosition,
    path: null,
    repeatCount: 0,
    spanDuration: 0,
    velocity: 0,
    nested: [],
  };
}

const nested = (kind: NestedObject['kind'], startTime: number, position: V2): NestedObject => ({ kind, startTime, position, stackedPosition: position });

function applyStacking(objs: OsuObject[], formatVersion: number, threshold: number) {
  if (objs.length === 0) return;
  if (formatVersion >= 6) applyStackingNew(objs, threshold);
  else applyStackingOld(objs, threshold);
}

function applyStackingNew(objs: OsuObject[], threshold: number) {
  for (let i = objs.length - 1; i > 0; i--) {
    let n = i;
    let objI = objs[i];
    if (objI.stackHeight !== 0 || objI.kind === 'spinner') continue;
    if (objI.kind === 'circle') {
      while (--n >= 0) {
        const objN = objs[n];
        if (objN.kind === 'spinner') continue;
        if (Math.trunc(objI.startTime) - Math.trunc(objN.endTime) > threshold) break;
        if (objN.kind === 'slider' && distance(objN.endPosition, objI.position) < STACK_DISTANCE) {
          const offset = objI.stackHeight - objN.stackHeight + 1;
          for (let j = n + 1; j <= i; j++) {
            const objJ = objs[j];
            if (distance(objN.endPosition, objJ.position) < STACK_DISTANCE) objJ.stackHeight -= offset;
          }
          break;
        }
        if (distance(objN.position, objI.position) < STACK_DISTANCE) {
          objN.stackHeight = objI.stackHeight + 1;
          objI = objN;
        }
      }
    } else {
      while (--n >= 0) {
        const objN = objs[n];
        if (objN.kind === 'spinner') continue;
        if (objI.startTime - objN.startTime > threshold) break;
        if (distance(objN.endPosition, objI.position) < STACK_DISTANCE) {
          objN.stackHeight = objI.stackHeight + 1;
          objI = objN;
        }
      }
    }
  }
}

function applyStackingOld(objs: OsuObject[], threshold: number) {
  for (let i = 0; i < objs.length; i++) {
    const curr = objs[i];
    if (curr.stackHeight !== 0 && curr.kind !== 'slider') continue;
    let startTime = curr.endTime;
    let sliderStack = 0;
    for (let j = i + 1; j < objs.length; j++) {
      if (objs[j].startTime - threshold > startTime) break;
      const position2 = curr.kind === 'slider' ? add(curr.position, curr.path!.positionAt(1)) : curr.position;
      if (distance(objs[j].position, curr.position) < STACK_DISTANCE) {
        curr.stackHeight++;
        startTime = objs[j].startTime;
      } else if (distance(objs[j].position, position2) < STACK_DISTANCE) {
        sliderStack++;
        objs[j].stackHeight -= sliderStack;
        startTime = objs[j].startTime;
      }
    }
  }
}
