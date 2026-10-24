// osu!catch star rating, ported from lazer's osu.Game.Rulesets.Catch/Difficulty (ppy/osu 2026.730.0,
// difficulty calculator version 20260706). Native catch maps only (no converts), no mods.
import type { Beatmap } from '../types';
import {
  circleScaleNoFudge,
  clamp,
  controlPoints,
  difficultyPointAt,
  difficultySettings,
  legacyPosition,
  legacySliderPath,
  precisionAdjustedBeatLength,
  sliderEvents,
  timeOffset,
  timingPointAt,
} from './objects';
import { DifficultyHitObject, StrainDecaySkill } from './skills';
import { f32 } from './vec';

const WIDTH = 512;
const NORMALIZED_HALF_CATCHER_WIDTH = f32(41);
const ABSOLUTE_PLAYER_POSITIONING_ERROR = f32(16);

interface Palpable {
  kind: 'fruit' | 'droplet' | 'tiny';
  startTime: number;
  /** EffectiveX (no offsets apply without mods). */
  x: number;
  hyperDash: boolean;
  distanceToHyperDash: number;
}

/** Catcher.CalculateCatchWidth. */
function catchWidth(cs: number): number {
  const s = f32(circleScaleNoFudge(cs) * 2);
  return f32(f32(f32(106.75) * Math.abs(s)) * f32(0.8));
}

const effectiveX = (x: number) => clamp(x, 0, WIDTH);

function palpableObjects(bm: Beatmap): Palpable[] {
  const diff = difficultySettings(bm);
  const cp = controlPoints(bm);
  const offset = timeOffset(bm);
  const out: { o: Palpable; order: number }[] = [];
  const add = (kind: Palpable['kind'], startTime: number, x: number) => out.push({ o: { kind, startTime, x: effectiveX(f32(x)), hyperDash: false, distanceToHyperDash: 0 }, order: out.length });
  const sorted = [...bm.hitObjects].sort((a, b) => a.time - b.time);
  for (const h of sorted) {
    const startTime = h.time + offset;
    if (h.kind === 'spinner' || h.kind === 'hold') continue; // bananas don't count
    const pos = legacyPosition(h, bm.formatVersion);
    if (h.kind === 'circle') {
      add('fruit', startTime, pos.x);
      continue;
    }
    const path = legacySliderPath(h, bm.formatVersion, pos, false);
    const repeatCount = Math.abs(path.distance) <= 1e-7 ? 0 : Math.max(0, h.slides - 1);
    const spanCount = repeatCount + 1;
    const dp = difficultyPointAt(cp, startTime);
    const tp = timingPointAt(cp, startTime);
    const velocity = (100 * diff.sliderMultiplier) / precisionAdjustedBeatLength(dp.sliderVelocity, tp.beatLength, false);
    const tickDistance = ((velocity * tp.beatLength) / diff.sliderTickRate) * (bm.formatVersion < 8 ? 1 / dp.sliderVelocity : 1);
    const spanDuration = (spanCount * path.distance) / velocity / spanCount;
    const streamX = effectiveX(pos.x);
    const nested: Palpable[] = [];
    const nestedAdd = (kind: Palpable['kind'], t: number, x: number) => nested.push({ kind, startTime: t, x: effectiveX(f32(x)), hyperDash: false, distanceToHyperDash: 0 });
    let last: ReturnType<typeof sliderEvents>[number] | null = null;
    for (const e of sliderEvents(startTime, spanDuration, velocity, tickDistance, path.distance, spanCount)) {
      if (last) {
        const sinceLastTick = Math.trunc(e.time) - Math.trunc(last.time);
        if (sinceLastTick > 80) {
          let timeBetweenTiny = sinceLastTick;
          while (timeBetweenTiny > 100) timeBetweenTiny /= 2;
          for (let t = timeBetweenTiny; t < sinceLastTick; t += timeBetweenTiny) {
            nestedAdd('tiny', t + last.time, streamX + path.positionAt(last.pathProgress + (t / sinceLastTick) * (e.pathProgress - last.pathProgress)).x);
          }
        }
      }
      last = e;
      if (e.kind === 'tick') nestedAdd('droplet', e.time, streamX + path.positionAt(e.pathProgress).x);
      else if (e.kind !== 'legacyLastTick') nestedAdd('fruit', e.time, streamX + path.positionAt(e.pathProgress).x);
    }
    nested.sort((a, b) => a.startTime - b.startTime);
    for (const n of nested) out.push({ o: n, order: out.length });
  }
  return out.sort((a, b) => a.o.startTime - b.o.startTime || a.order - b.order).map((p) => p.o);
}

function initialiseHyperDash(objects: Palpable[], cs: number) {
  const palpable = objects.filter((h) => h.kind !== 'tiny');
  let halfCatcherWidth = f32(catchWidth(cs) / 2);
  halfCatcherWidth /= f32(0.8);
  const grace = f32(f32(f32(1000) / f32(60)) / 4);
  let lastDirection = 0;
  let lastExcess = halfCatcherWidth;
  for (let i = 0; i < palpable.length - 1; i++) {
    const current = palpable[i];
    const next = palpable[i + 1];
    current.hyperDash = false;
    current.distanceToHyperDash = 0;
    const thisDirection = next.x > current.x ? 1 : -1;
    const timeToNext = f32(Math.trunc(next.startTime) - Math.trunc(current.startTime) - grace);
    const distanceToNext = Math.abs(f32(next.x - current.x)) - (lastDirection === thisDirection ? lastExcess : halfCatcherWidth);
    const distanceToHyper = f32(timeToNext * 1.0 - distanceToNext);
    if (distanceToHyper < 0) {
      current.hyperDash = true;
      lastExcess = halfCatcherWidth;
    } else {
      current.distanceToHyperDash = distanceToHyper;
      lastExcess = clamp(distanceToHyper, 0, halfCatcherWidth);
    }
    lastDirection = thisDirection;
  }
}

const times = { start: (o: Palpable) => o.startTime, end: (o: Palpable) => o.startTime };

class CatchDifficultyHitObject extends DifficultyHitObject<Palpable> {
  readonly normalizedPosition: number;
  readonly lastNormalizedPosition: number;
  readonly strainTime: number;
  playerPosition = 0;
  lastPlayerPosition = 0;
  distanceMoved = 0;
  exactDistanceMoved = 0;

  constructor(hitObject: Palpable, lastObject: Palpable, clockRate: number, halfCatcherWidth: number, objects: CatchDifficultyHitObject[], index: number) {
    super(hitObject, lastObject, clockRate, objects as DifficultyHitObject<Palpable>[], index, times);
    const scalingFactor = f32(NORMALIZED_HALF_CATCHER_WIDTH / halfCatcherWidth);
    this.normalizedPosition = f32(hitObject.x * scalingFactor);
    this.lastNormalizedPosition = f32(lastObject.x * scalingFactor);
    this.strainTime = Math.max(40, this.deltaTime);
    this.lastPlayerPosition = index === 0 ? this.lastNormalizedPosition : this.previous(0)!.playerPosition;
    const margin = f32(NORMALIZED_HALF_CATCHER_WIDTH - ABSOLUTE_PLAYER_POSITIONING_ERROR);
    this.playerPosition = clamp(this.lastPlayerPosition, f32(this.normalizedPosition - margin), f32(this.normalizedPosition + margin));
    this.distanceMoved = f32(this.playerPosition - this.lastPlayerPosition);
    this.exactDistanceMoved = f32(this.normalizedPosition - this.lastPlayerPosition);
    if (lastObject.hyperDash) this.playerPosition = this.normalizedPosition;
  }
}

function movementDifficulty(current: CatchDifficultyHitObject): number {
  const directionChangeBonus = 21;
  const last = current.previous(0);
  const lastLast = current.previous(1);
  const catcherSpeedMultiplier = current.clockRate;
  const weightedStrainTime = current.strainTime + 13 + 3 / catcherSpeedMultiplier;
  let distanceAddition = Math.pow(Math.abs(current.distanceMoved), 1.3) / 510;
  const sqrtStrain = Math.sqrt(weightedStrainTime);
  let edgeDashBonus = 0;

  if (Math.abs(current.distanceMoved) > 0.1) {
    if (current.index >= 1 && Math.abs(last!.distanceMoved) > 0.1 && Math.sign(current.distanceMoved) !== Math.sign(last!.distanceMoved)) {
      const bonusFactor = f32(Math.min(50, Math.abs(current.distanceMoved)) / 50);
      const antiflowFactor = Math.max(f32(Math.min(70, Math.abs(last!.distanceMoved)) / 70), 0.38);
      distanceAddition += (directionChangeBonus / Math.sqrt(last!.strainTime + 16)) * bonusFactor * antiflowFactor * Math.max(1 - Math.pow(weightedStrainTime / 1000, 3), 0);
    }
    distanceAddition += (12.5 * Math.min(Math.abs(current.distanceMoved), f32(NORMALIZED_HALF_CATCHER_WIDTH * 2))) / f32(NORMALIZED_HALF_CATCHER_WIDTH * 6) / sqrtStrain;
  }

  let linearSpacingCount = 0;
  for (let i = 0; i < Math.min(current.index, 10); i++) {
    const prev = current.previous(i)!;
    if (Math.sign(current.distanceMoved) !== Math.sign(prev.distanceMoved) || current.distanceMoved === 0 || prev.distanceMoved === 0) break;
    const currentSpacing = Math.abs(current.distanceMoved / current.strainTime);
    const prevSpacing = Math.abs(prev.distanceMoved / prev.strainTime);
    if (Math.abs(currentSpacing / prevSpacing - 1) > 0.05) break;
    linearSpacingCount++;
  }
  distanceAddition *= Math.pow(0.7, linearSpacingCount);

  const lastObject = current.lastObject;
  if (lastObject.distanceToHyperDash <= 20) {
    if (!lastObject.hyperDash) edgeDashBonus += 5.7;
    distanceAddition *=
      1 + edgeDashBonus * f32(f32(20 - lastObject.distanceToHyperDash) / 20) * Math.pow(Math.min(current.strainTime * catcherSpeedMultiplier, 265) / 265, 1.5);
  }

  if (
    current.index >= 2 &&
    Math.abs(current.exactDistanceMoved) <= f32(NORMALIZED_HALF_CATCHER_WIDTH * 2) &&
    current.exactDistanceMoved === -last!.exactDistanceMoved &&
    last!.exactDistanceMoved === -lastLast!.exactDistanceMoved &&
    current.strainTime === last!.strainTime &&
    last!.strainTime === lastLast!.strainTime
  )
    distanceAddition = 0;

  return distanceAddition / weightedStrainTime;
}

class Movement extends StrainDecaySkill<CatchDifficultyHitObject> {
  protected skillMultiplier = 1;
  protected strainDecayBase = 0.2;
  protected decayWeight = 0.94;
  protected sectionLength = 750;
  protected strainValueOf(current: CatchDifficultyHitObject) {
    return movementDifficulty(current);
  }
}

export function catchStarRating(bm: Beatmap, clockRate = 1): number {
  if (bm.hitObjects.length === 0) return 0;
  const diff = difficultySettings(bm);
  const objects = palpableObjects(bm);
  initialiseHyperDash(objects, diff.circleSize);
  let halfCatcherWidth = f32(catchWidth(diff.circleSize) * f32(0.5));
  halfCatcherWidth = f32(halfCatcherWidth * f32(1 - f32(Math.max(0, f32(diff.circleSize - f32(5.5))) * f32(0.0625))));
  const diffObjects: CatchDifficultyHitObject[] = [];
  let last: Palpable | null = null;
  for (const o of objects) {
    if (o.kind === 'tiny') continue;
    if (last) diffObjects.push(new CatchDifficultyHitObject(o, last, clockRate, halfCatcherWidth, diffObjects, diffObjects.length));
    last = o;
  }
  const movement = new Movement();
  for (const o of diffObjects) movement.process(o);
  return Math.sqrt(movement.difficultyValue()) * 4.59;
}
