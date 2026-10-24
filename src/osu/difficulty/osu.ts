// osu!standard star rating, ported from lazer's osu.Game.Rulesets.Osu/Difficulty (ppy/osu 2026.730.0,
// difficulty calculator version 20260706, the version osu-web's difficulty calculator runs). No mods.
import type { Beatmap } from '../types';
import { convertOsu, TAIL_LENIENCY, type NestedObject, type OsuBeatmap, type OsuObject } from './objects';
import {
  bpmToMilliseconds,
  clamp,
  degToRad,
  DifficultyHitObject,
  dotnetLerp,
  harmonicDifficultyToPerformance,
  HarmonicSkill,
  lerp,
  logistic,
  logisticExp,
  millisecondsToBpm,
  norm,
  reverseLerp,
  smootherstep,
  smoothstep,
  smoothstepBellCurve,
  VariableLengthStrainSkill,
  type StrainPeak,
} from './skills';
import { add, distance, dot, f32, length, scale, sub, type V2 } from './vec';

const NORMALISED_RADIUS = 50;
const NORMALISED_DIAMETER = NORMALISED_RADIUS * 2;
const MIN_DELTA_TIME = 25;
const MAXIMUM_SLIDER_RADIUS = f32(NORMALISED_RADIUS * f32(2.4));
const ASSUMED_SLIDER_RADIUS = f32(NORMALISED_RADIUS * f32(1.8));
const PREEMPT_MIN = 450;
const PERFORMANCE_BASE_MULTIPLIER = 1.12;
const PERFORMANCE_NORM_EXPONENT = 1.1;

const times = { start: (o: OsuObject) => o.startTime, end: (o: OsuObject) => o.endTime };

export class OsuDifficultyHitObject extends DifficultyHitObject<OsuObject> {
  readonly adjustedDeltaTime: number;
  readonly lastObjectEndDeltaTime: number;
  readonly hitWindowGreat: number;
  readonly radius: number;
  readonly timePreempt: number;
  jumpDistance = 0;
  lazyJumpDistance = 0;
  minimumJumpDistance = 0;
  minimumJumpTime = 0;
  travelDistance = 0;
  travelTime = 0;
  lazyEndPosition: V2 | null = null;
  lazyTravelDistance = 0;
  lazyTravelTime = 0;
  angle: number | null = null;
  normalisedVectorAngle: number | null = null;

  constructor(hitObject: OsuObject, lastObject: OsuObject, clockRate: number, objects: OsuDifficultyHitObject[], index: number, map: OsuBeatmap) {
    super(hitObject, lastObject, clockRate, objects as DifficultyHitObject<OsuObject>[], index, times);
    this.radius = map.radius;
    this.timePreempt = map.preempt;
    this.hitWindowGreat = hitObject.kind === 'spinner' ? 0 : (2 * map.greatWindow) / clockRate;
    this.adjustedDeltaTime = Math.max(this.deltaTime, MIN_DELTA_TIME);
    const last = this.previous();
    this.lastObjectEndDeltaTime = last ? Math.max(this.startTime - last.endTime, MIN_DELTA_TIME) : this.adjustedDeltaTime;
    this.computeSliderCursorPosition();
    this.setDistances(clockRate);
  }

  get preempt() {
    return this.timePreempt / this.clockRate;
  }

  get smallCircleBonus() {
    return Math.max(1, 1 + (30 - this.radius) / 70);
  }

  get overallDifficulty() {
    return (79.5 - this.hitWindowGreat / 2) / 6;
  }

  opacityAt(time: number): number {
    const base = this.baseObject;
    if (time > base.startTime) return 0;
    const fadeInStartTime = base.startTime - this.timePreempt;
    const fadeInDuration = 400 * Math.min(1, this.timePreempt / PREEMPT_MIN);
    return clamp((time - fadeInStartTime) / fadeInDuration, 0, 1);
  }

  calculateDoubleTapFeasibility(nextObj: OsuDifficultyHitObject | null): number {
    if (!nextObj) return 0;
    const currDeltaTime = Math.max(1, this.deltaTime);
    const nextDeltaTime = Math.max(1, nextObj.deltaTime);
    const deltaDifference = Math.abs(nextDeltaTime - currDeltaTime);
    const speedRatio = currDeltaTime / Math.max(currDeltaTime, deltaDifference);
    const windowRatio = Math.pow(Math.min(1, currDeltaTime / this.hitWindowGreat), 5);
    const distanceFactor = Math.pow(reverseLerp(this.lazyJumpDistance, NORMALISED_DIAMETER, NORMALISED_RADIUS), 2);
    return 1 - Math.pow(speedRatio, distanceFactor * (1 - windowRatio));
  }

  private setDistances(clockRate: number) {
    const base = this.baseObject;
    const lastObj = this.lastObject;
    if (base.kind === 'slider') {
      this.travelDistance = this.lazyTravelDistance * Math.max(1, Math.pow(base.repeatCount, 0.3));
      this.travelTime = Math.max(this.lazyTravelTime / clockRate, MIN_DELTA_TIME);
    }
    this.minimumJumpTime = this.adjustedDeltaTime;
    if (base.kind === 'spinner' || lastObj.kind === 'spinner') return;

    const scalingFactor = f32(NORMALISED_RADIUS / f32(this.radius));
    const lastDiff = this.previous();
    const lastLastDiff = this.previous(1);
    let lastCursorPosition = lastDiff ? endCursorPosition(lastDiff) : lastObj.stackedPosition;

    this.jumpDistance = f32(length(sub(lastObj.stackedPosition, base.stackedPosition)) * scalingFactor);
    this.lazyJumpDistance = f32(length(sub(base.stackedPosition, lastCursorPosition)) * scalingFactor);
    this.minimumJumpDistance = this.lazyJumpDistance;

    if (lastObj.kind === 'slider' && lastDiff) {
      const lastTravelTime = Math.max(lastDiff.lazyTravelTime / clockRate, MIN_DELTA_TIME);
      this.minimumJumpTime = Math.max(this.adjustedDeltaTime - lastTravelTime, MIN_DELTA_TIME);
      const tail = lastObj.nested.find((n) => n.kind === 'tail')!;
      const tailJumpDistance = f32(length(sub(tail.stackedPosition, base.stackedPosition)) * scalingFactor);
      this.minimumJumpDistance = Math.max(
        0,
        Math.min(this.lazyJumpDistance - f32(MAXIMUM_SLIDER_RADIUS - ASSUMED_SLIDER_RADIUS), f32(tailJumpDistance - MAXIMUM_SLIDER_RADIUS)),
      );
    }

    if (lastLastDiff && lastLastDiff.baseObject.kind !== 'spinner') {
      if (lastDiff!.baseObject.kind === 'slider' && lastDiff!.travelDistance > 0) lastCursorPosition = lastDiff!.baseObject.stackedPosition;
      const lastLastCursorPosition = endCursorPosition(lastLastDiff);
      const angle = calculateAngle(base.stackedPosition, lastCursorPosition, lastLastCursorPosition);
      const sliderAngle = this.calculateSliderAngle(lastDiff!, lastLastCursorPosition);
      const v = sub(base.stackedPosition, lastCursorPosition);
      this.normalisedVectorAngle = Math.atan2(Math.abs(v.y), Math.abs(v.x));
      this.angle = Math.min(angle, sliderAngle);
    }
  }

  private computeSliderCursorPosition() {
    const slider = this.baseObject;
    if (slider.kind !== 'slider' || this.lazyEndPosition) return;
    const duration = slider.endTime - slider.startTime;
    let trackingEndTime = Math.max(slider.startTime + duration + TAIL_LENIENCY, slider.startTime + duration / 2);
    let nestedObjects: NestedObject[] = slider.nested;
    let lastRealTick: NestedObject | null = null;
    for (const n of slider.nested) if (n.kind === 'tick') lastRealTick = n;
    if (lastRealTick && lastRealTick.startTime > trackingEndTime) {
      trackingEndTime = lastRealTick.startTime;
      // lazer moves the last tick to the end here to keep known diffcalc output.
      nestedObjects = nestedObjects.filter((n) => n !== lastRealTick);
      nestedObjects.push(lastRealTick);
    }
    this.lazyTravelTime = trackingEndTime - slider.startTime;
    let endTimeMin = this.lazyTravelTime / slider.spanDuration;
    if (endTimeMin % 2 >= 1) endTimeMin = 1 - (endTimeMin % 1);
    else endTimeMin %= 1;
    let lazyEnd = add(slider.stackedPosition, slider.path!.positionAt(endTimeMin));
    let cursor = slider.stackedPosition;
    const scalingFactor = NORMALISED_RADIUS / this.radius;
    for (let i = 1; i < nestedObjects.length; i++) {
      const obj = nestedObjects[i];
      let movement = sub(obj.stackedPosition, cursor);
      let movementLength = scalingFactor * length(movement);
      let requiredMovement = ASSUMED_SLIDER_RADIUS;
      if (i === nestedObjects.length - 1) {
        const lazyMovement = sub(lazyEnd, cursor);
        if (length(lazyMovement) < length(movement)) movement = lazyMovement;
        movementLength = scalingFactor * length(movement);
      } else if (obj.kind === 'repeat') requiredMovement = NORMALISED_RADIUS;
      if (movementLength > requiredMovement) {
        cursor = add(cursor, scale(movement, f32((movementLength - requiredMovement) / movementLength)));
        movementLength *= (movementLength - requiredMovement) / movementLength;
        this.lazyTravelDistance += movementLength;
      }
      if (i === nestedObjects.length - 1) lazyEnd = cursor;
    }
    this.lazyEndPosition = lazyEnd;
  }

  private calculateSliderAngle(lastDiff: OsuDifficultyHitObject, lastLastCursorPosition: V2): number {
    const lastCursorPosition = endCursorPosition(lastDiff);
    const prev = lastDiff.baseObject;
    if (prev.kind === 'slider' && lastDiff.travelDistance > 0) lastLastCursorPosition = prev.nested[prev.nested.length - 2].stackedPosition;
    return calculateAngle(this.baseObject.stackedPosition, lastCursorPosition, lastLastCursorPosition);
  }
}

function calculateAngle(current: V2, last: V2, lastLast: V2): number {
  const v1 = sub(lastLast, last);
  const v2 = sub(current, last);
  const d = dot(v1, v2);
  const det = f32(f32(v1.x * v2.y) - f32(v1.y * v2.x));
  return Math.abs(Math.atan2(det, d));
}

const endCursorPosition = (o: OsuDifficultyHitObject) => o.lazyEndPosition ?? o.baseObject.stackedPosition;

// --- Evaluators ---

const calcAngleWideness = (angle: number) => smoothstep(angle, degToRad(40), degToRad(140));
const calcAngleAcuteness = (angle: number) => smoothstep(angle, degToRad(140), degToRad(40));

function snapAim(current: OsuDifficultyHitObject, withSliderTravelDistance: boolean): number {
  const curr = current;
  const last = current.previous();
  if (current.baseObject.kind === 'spinner' || current.index <= 1 || !last || last.baseObject.kind === 'spinner') return 0;
  const wideAngleMultiplier = 9.67;
  const acuteAngleMultiplier = 2.41;
  const sliderMultiplier = 1.5;
  const velocityChangeMultiplier = 0.9;
  const wiggleMultiplier = 1.02;
  const last2 = current.previous(2);
  const radius = NORMALISED_RADIUS;
  const diameter = NORMALISED_DIAMETER;

  const currDistance = withSliderTravelDistance ? curr.lazyJumpDistance : curr.jumpDistance;
  let currVelocity = currDistance / curr.adjustedDeltaTime;
  if (last.baseObject.kind === 'slider' && withSliderTravelDistance) {
    const sliderDistance = last.lazyTravelDistance + curr.lazyJumpDistance;
    currVelocity = Math.max(currVelocity, sliderDistance / curr.adjustedDeltaTime);
  }
  const prevDistance = withSliderTravelDistance ? last.lazyJumpDistance : last.jumpDistance;
  const prevVelocity = prevDistance / last.adjustedDeltaTime;

  let snapDifficulty = currVelocity;
  snapDifficulty *= vectorAngleRepetition(curr, last);

  if (curr.angle !== null && last.angle !== null) {
    const currAngle = curr.angle;
    const lastAngle = last.angle;
    const velocityInfluence = Math.min(currVelocity, prevVelocity);
    let acuteAngleBonus = 0;
    if (Math.max(curr.adjustedDeltaTime, last.adjustedDeltaTime) < 1.25 * Math.min(curr.adjustedDeltaTime, last.adjustedDeltaTime)) {
      acuteAngleBonus = calcAngleAcuteness(currAngle);
      acuteAngleBonus *= 0.08 + 0.92 * (1 - Math.min(acuteAngleBonus, Math.pow(calcAngleAcuteness(lastAngle), 3)));
      acuteAngleBonus *= velocityInfluence * smootherstep(millisecondsToBpm(curr.adjustedDeltaTime, 2), 300, 400) * smootherstep(currDistance, 0, diameter * 2);
    }
    let wideAngleBonus = calcAngleWideness(currAngle);
    wideAngleBonus *= 0.25 + 0.75 * (1 - Math.min(wideAngleBonus, Math.pow(calcAngleWideness(lastAngle), 3)));
    const wideAngleTimeScale = 1.45;
    let wideAngleCurrVelocity = currDistance / Math.pow(curr.adjustedDeltaTime, wideAngleTimeScale);
    const wideAnglePrevVelocity = prevDistance / Math.pow(last.adjustedDeltaTime, wideAngleTimeScale);
    if (last.baseObject.kind === 'slider' && withSliderTravelDistance) {
      const sliderDistance = last.lazyTravelDistance + curr.lazyJumpDistance;
      wideAngleCurrVelocity = Math.max(wideAngleCurrVelocity, sliderDistance / Math.pow(curr.adjustedDeltaTime, wideAngleTimeScale));
    }
    wideAngleBonus *= Math.min(wideAngleCurrVelocity, wideAnglePrevVelocity);
    if (last2) {
      const d = length(sub(last2.baseObject.stackedPosition, last.baseObject.stackedPosition));
      if (d < 1) wideAngleBonus *= 1 - 0.55 * (1 - d);
    }
    snapDifficulty += Math.max(acuteAngleBonus * acuteAngleMultiplier, wideAngleBonus * wideAngleMultiplier);
    const wiggleBonus =
      velocityInfluence *
      smootherstep(currDistance, radius, diameter) *
      Math.pow(reverseLerp(currDistance, diameter * 3, diameter), 1.8) *
      smootherstep(currAngle, degToRad(110), degToRad(60)) *
      smootherstep(prevDistance, radius, diameter) *
      Math.pow(reverseLerp(prevDistance, diameter * 3, diameter), 1.8) *
      smootherstep(lastAngle, degToRad(110), degToRad(60));
    snapDifficulty += wiggleBonus * wiggleMultiplier;
  }

  if (Math.max(prevVelocity, currVelocity) !== 0) {
    if (withSliderTravelDistance) currVelocity = currDistance / curr.adjustedDeltaTime;
    const distRatio = smoothstep(Math.abs(prevVelocity - currVelocity) / Math.max(prevVelocity, currVelocity), 0, 1);
    const overlapVelocityBuff = Math.min((diameter * 1.25) / Math.min(curr.adjustedDeltaTime, last.adjustedDeltaTime), Math.abs(prevVelocity - currVelocity));
    let velocityChangeBonus = overlapVelocityBuff * distRatio;
    velocityChangeBonus *= Math.pow(Math.min(curr.adjustedDeltaTime, last.adjustedDeltaTime) / Math.max(curr.adjustedDeltaTime, last.adjustedDeltaTime), 2);
    snapDifficulty += velocityChangeBonus * velocityChangeMultiplier;
  }

  if (curr.baseObject.kind === 'slider' && withSliderTravelDistance) {
    const sliderBonus = curr.travelDistance / curr.travelTime;
    snapDifficulty += (sliderBonus < 1 ? sliderBonus : Math.pow(sliderBonus, 0.75)) * sliderMultiplier;
  }

  snapDifficulty *= curr.smallCircleBonus;
  snapDifficulty *= 1 / (1 - Math.pow(0.03, Math.pow(curr.adjustedDeltaTime / 1000, 0.65)));
  return snapDifficulty;
}

function vectorAngleRepetition(current: OsuDifficultyHitObject, previous: OsuDifficultyHitObject): number {
  if (current.angle === null || previous.angle === null) return 1;
  const noteLimit = 6;
  const maximumRepetitionNerf = 0.15;
  const maximumVectorInfluence = 0.5;
  let constantAngleCount = 0;
  for (let index = 0; index < noteLimit; index++) {
    const prevObj = current.previous(index);
    if (!prevObj) break;
    if (Math.max(current.adjustedDeltaTime, prevObj.adjustedDeltaTime) > 1.1 * Math.min(current.adjustedDeltaTime, prevObj.adjustedDeltaTime)) break;
    if (prevObj.normalisedVectorAngle !== null && current.normalisedVectorAngle !== null) {
      const angleDifference = Math.abs(current.normalisedVectorAngle - prevObj.normalisedVectorAngle);
      constantAngleCount += Math.cos(8 * Math.min(degToRad(11.25), angleDifference));
    }
  }
  const vectorRepetition = Math.pow(Math.min(0.5 / constantAngleCount, 1), 2);
  const stackFactor = smootherstep(current.lazyJumpDistance, 0, NORMALISED_DIAMETER);
  const angleDifferenceAdjusted = Math.cos(2 * Math.min(degToRad(45), Math.abs(current.angle - previous.angle) * stackFactor));
  const baseNerf = 1 - maximumRepetitionNerf * calcAngleAcuteness(previous.angle) * angleDifferenceAdjusted;
  return Math.pow(baseNerf + (1 - baseNerf) * vectorRepetition * maximumVectorInfluence * stackFactor, 2);
}

function agility(current: OsuDifficultyHitObject): number {
  if (current.baseObject.kind === 'spinner') return 0;
  const distanceCap = NORMALISED_DIAMETER * 1.2;
  const prev = current.index > 0 ? current.previous(0) : null;
  const travelDistance = prev?.lazyTravelDistance ?? 0;
  const dist = travelDistance + current.lazyJumpDistance;
  const distanceScaled = Math.min(dist, distanceCap) / distanceCap;
  let difficulty = (distanceScaled * 1000) / current.adjustedDeltaTime;
  difficulty *= Math.pow(current.smallCircleBonus, 1.5);
  difficulty *= 1 / (1 - Math.pow(0.2, current.adjustedDeltaTime / 1000));
  return difficulty;
}

function overlapFactor(first: OsuDifficultyHitObject, second: OsuDifficultyHitObject): number {
  const objectRadius = first.radius;
  const d = distance(first.baseObject.stackedPosition, second.baseObject.stackedPosition);
  return clamp(1 - Math.pow(Math.max(d - objectRadius, 0) / objectRadius, 2), 0, 1);
}

function flowAim(current: OsuDifficultyHitObject, withSliderTravelDistance: boolean): number {
  const curr = current;
  const last = current.previous();
  if (current.baseObject.kind === 'spinner' || current.index <= 1 || !last || last.baseObject.kind === 'spinner') return 0;
  const velocityChangeMultiplier = 0.52;
  const lastLast = current.previous(1)!;
  const currDistance = withSliderTravelDistance ? curr.lazyJumpDistance : curr.jumpDistance;
  const prevDistance = withSliderTravelDistance ? last.lazyJumpDistance : last.jumpDistance;
  let currVelocity = currDistance / curr.adjustedDeltaTime;
  if (last.baseObject.kind === 'slider' && withSliderTravelDistance) {
    const sliderDistance = last.lazyTravelDistance + curr.lazyJumpDistance;
    currVelocity = Math.max(currVelocity, sliderDistance / curr.adjustedDeltaTime);
  }
  const prevVelocity = prevDistance / last.adjustedDeltaTime;
  let flowDifficulty = currVelocity;
  flowDifficulty *= Math.sqrt(curr.smallCircleBonus);
  flowDifficulty *=
    1 +
    Math.min(
      0.25,
      Math.pow(
        (Math.max(curr.adjustedDeltaTime, last.adjustedDeltaTime) - Math.min(curr.adjustedDeltaTime, last.adjustedDeltaTime)) / 50,
        4,
      ),
    );
  if (curr.angle !== null && last.angle !== null) {
    const angleDifference = Math.abs(curr.angle - last.angle);
    const angleDifferenceAdjusted = Math.sin(angleDifference / 2) * 180;
    const angularVelocity = angleDifferenceAdjusted / (curr.adjustedDeltaTime * 0.1);
    flowDifficulty *= 0.8 + Math.sqrt(angularVelocity / 270);
  }
  let overlappedNotesWeight = 1;
  if (current.index > 2) {
    const o1 = overlapFactor(curr, last);
    const o2 = overlapFactor(curr, lastLast);
    const o3 = overlapFactor(last, lastLast);
    overlappedNotesWeight = 1 - o1 * o2 * o3;
  }
  if (curr.angle !== null) flowDifficulty += currVelocity * calcAngleAcuteness(curr.angle) * overlappedNotesWeight;
  if (Math.max(prevVelocity, currVelocity) !== 0) {
    if (withSliderTravelDistance) currVelocity = currDistance / curr.adjustedDeltaTime;
    const distRatio = smoothstep(Math.abs(prevVelocity - currVelocity) / Math.max(prevVelocity, currVelocity), 0, 1);
    const overlapVelocityBuff = Math.min((NORMALISED_DIAMETER * 1.25) / Math.min(curr.adjustedDeltaTime, last.adjustedDeltaTime), Math.abs(prevVelocity - currVelocity));
    flowDifficulty += overlapVelocityBuff * distRatio * overlappedNotesWeight * velocityChangeMultiplier;
  }
  if (curr.baseObject.kind === 'slider' && withSliderTravelDistance) flowDifficulty += curr.travelDistance / curr.travelTime;
  flowDifficulty = Math.pow(flowDifficulty, 1.45);
  return flowDifficulty * smootherstep(currDistance, 0, NORMALISED_RADIUS);
}

function speedDifficulty(current: OsuDifficultyHitObject): number {
  if (current.baseObject.kind === 'spinner') return 0;
  const minSpeedBonus = 200;
  const speedBalancingFactor = 40;
  let strainTime = current.adjustedDeltaTime;
  const doubleTapFeasibility = 1 - current.calculateDoubleTapFeasibility(current.next(0));
  strainTime /= clamp(strainTime / current.hitWindowGreat / 0.93, 0.92, 1);
  let speedBonus = 0;
  if (millisecondsToBpm(strainTime) > minSpeedBonus) speedBonus = 0.75 * Math.pow((bpmToMilliseconds(minSpeedBonus) - strainTime) / speedBalancingFactor, 2);
  let difficulty = ((1 + speedBonus) * 1000) / strainTime;
  difficulty *= 1 / (1 - Math.pow(0.3, current.adjustedDeltaTime / 1000));
  return difficulty * doubleTapFeasibility;
}

class Island {
  delta: number;
  deltaCount = 1;
  occurrences = 1;

  constructor(delta: number) {
    this.delta = Math.max(delta, MIN_DELTA_TIME);
  }

  addDelta(delta: number) {
    if (this.delta === INT_MAX) this.delta = Math.max(delta, MIN_DELTA_TIME);
    this.deltaCount++;
  }

  isSimilarPolarity(other: Island, epsilon: number) {
    if (this.deltaCount <= 1 || other.deltaCount <= 1) return false;
    return Math.abs(this.delta - other.delta) < epsilon && this.deltaCount % 2 === other.deltaCount % 2;
  }

  almostEquals(other: Island, epsilon: number) {
    return Math.abs(this.delta - other.delta) < epsilon && this.deltaCount === other.deltaCount;
  }
}

const INT_MAX = 2147483647;
/** C#'s (int) cast of a positive double. */
const toInt = (x: number) => (x >= INT_MAX ? INT_MAX : Math.trunc(x));

function effectiveRhythmDifficulty(ratio: number): number {
  const fraction = ratio - Math.trunc(ratio);
  return 1 + 26 * Math.min(0.5, smoothstepBellCurve(fraction));
}

function rhythm(current: OsuDifficultyHitObject): number {
  if (current.baseObject.kind === 'spinner') return 0;
  const historyTimeMax = 5000;
  const historyObjectsMax = 32;
  const rhythmOverallMultiplier = 0.95;
  let rhythmComplexitySum = 0;
  const deltaDifferenceEpsilon = current.hitWindowGreat * 0.3;
  let island = new Island(INT_MAX);
  let previousIsland = new Island(INT_MAX);
  const islands: Island[] = [];
  let startDifficulty = 0;
  let firstDeltaSwitch = false;
  const historicalNoteCount = Math.min(current.index, historyObjectsMax);
  let rhythmStart = 0;
  while (rhythmStart < historicalNoteCount - 2 && current.startTime - current.previous(rhythmStart)!.startTime < historyTimeMax) rhythmStart++;
  let prevObj = current.previous(rhythmStart)!;
  let prevPrevObj = current.previous(rhythmStart + 1)!;

  for (let i = rhythmStart; i > 0; i--) {
    const currObj = current.previous(i - 1)!;
    if (currObj.baseObject.kind === 'spinner') continue;
    const timeDecay = (historyTimeMax - (current.startTime - currObj.startTime)) / historyTimeMax;
    const noteDecay = (historicalNoteCount - i) / historicalNoteCount;
    const currHistoricalDecay = Math.min(noteDecay, timeDecay);
    const deltaMinValue = 1e-7;
    const currDelta = Math.max(currObj.deltaTime, deltaMinValue);
    const prevDelta = Math.max(prevObj.deltaTime, deltaMinValue);
    const deltaDifference = Math.abs(prevDelta - currDelta);
    if (island.delta === INT_MAX) island = new Island(toInt(currDelta));
    const deltaDifferenceRatio = Math.max(prevDelta, currDelta) / Math.min(prevDelta, currDelta);
    const differenceMultiplier = clamp(2 - deltaDifferenceRatio / 8, 0, 1);
    const windowPenalty = clamp((deltaDifference - deltaDifferenceEpsilon) / deltaDifferenceEpsilon, 0, 1);
    let effectiveDifficulty = effectiveRhythmDifficulty(deltaDifferenceRatio) * windowPenalty * differenceMultiplier;

    if (prevObj.baseObject.kind === 'slider') {
      const sliderLazyEndDelta = currObj.minimumJumpTime;
      const sliderLazyRatio = Math.max(sliderLazyEndDelta, currDelta) / Math.min(sliderLazyEndDelta, currDelta);
      const sliderRealEndDelta = currObj.lastObjectEndDeltaTime;
      const sliderRealRatio = Math.max(sliderRealEndDelta, currDelta) / Math.min(sliderRealEndDelta, currDelta);
      const sliderEffective = Math.min(effectiveRhythmDifficulty(sliderLazyRatio), effectiveRhythmDifficulty(sliderRealRatio));
      effectiveDifficulty = Math.min(sliderEffective, effectiveDifficulty);
    }

    if (deltaDifference < deltaDifferenceEpsilon) island.addDelta(toInt(currDelta));

    if (firstDeltaSwitch) {
      if (deltaDifference > deltaDifferenceEpsilon) {
        if (currObj.baseObject.kind === 'slider') effectiveDifficulty *= 0.5;
        if (island.isSimilarPolarity(previousIsland, deltaDifferenceEpsilon)) effectiveDifficulty *= 0.5;
        if (Math.max(prevPrevObj.deltaTime, deltaMinValue) > prevDelta + deltaDifferenceEpsilon && prevDelta > currDelta + deltaDifferenceEpsilon) effectiveDifficulty *= 0.125;
        if (previousIsland.deltaCount === island.deltaCount) effectiveDifficulty *= 0.5;
        const isSpeedingUp = prevDelta > currDelta + deltaDifferenceEpsilon;
        if (isSpeedingUp) effectiveDifficulty *= 0.65;
        let found = false;
        for (const existing of islands) {
          if (existing.almostEquals(island, deltaDifferenceEpsilon)) {
            if (previousIsland.almostEquals(island, deltaDifferenceEpsilon)) existing.occurrences++;
            const power = logistic(island.delta, 58.33, 0.24, 2.75);
            effectiveDifficulty *= Math.min(3 / existing.occurrences, Math.pow(1 / existing.occurrences, power));
            found = true;
            break;
          }
        }
        if (!found && island.deltaCount > 0) islands.push(island);
        effectiveDifficulty *= 1 - prevObj.calculateDoubleTapFeasibility(currObj) * 0.75;
        if (island.deltaCount > 1) rhythmComplexitySum += Math.sqrt(effectiveDifficulty * startDifficulty) * currHistoricalDecay;
        else rhythmComplexitySum += 0.7 * currHistoricalDecay;
        startDifficulty = effectiveDifficulty;
        if (prevDelta + deltaDifferenceEpsilon < currDelta) firstDeltaSwitch = false;
        previousIsland = island;
        island = new Island(toInt(currDelta));
      }
    } else if (prevDelta > currDelta + deltaDifferenceEpsilon) {
      firstDeltaSwitch = true;
      if (currObj.baseObject.kind === 'slider') effectiveDifficulty *= 0.6;
      if (prevObj.baseObject.kind === 'slider') effectiveDifficulty *= 0.6;
      startDifficulty = effectiveDifficulty;
      island = new Island(toInt(currDelta));
    }
    prevPrevObj = prevObj;
    prevObj = currObj;
  }
  rhythmComplexitySum *= reverseLerp(island.deltaCount, 22, 3);
  return Math.sqrt(4 + rhythmComplexitySum * rhythmOverallMultiplier) / 2;
}

const READING_WINDOW_SIZE = 3000;
const DISTANCE_INFLUENCE_THRESHOLD = NORMALISED_DIAMETER * 1.5;
const timeNerfFactor = (deltaTime: number) => clamp(2 - deltaTime / (READING_WINDOW_SIZE / 2), 0, 1);

function reading(current: OsuDifficultyHitObject): number {
  if (current.baseObject.kind === 'spinner' || current.index === 0) return 0;
  const curr = current;
  const nextObj = current.next(0);
  const velocity = Math.max(1, curr.lazyJumpDistance / curr.adjustedDeltaTime);
  const currentVisibleObjectDensity = visibleObjectDensity(curr);
  const pastInfluence = pastObjectDifficultyInfluence(curr);
  const constantAngleNerf = constantAngleNerfFactor(curr);
  const noteDensityDifficulty = densityDifficulty(nextObj, velocity, constantAngleNerf, pastInfluence, currentVisibleObjectDensity);
  const preemptDifficulty = preemptDifficultyOf(velocity, constantAngleNerf, curr.preempt);
  let difficulty = norm(1.5, preemptDifficulty, 0, noteDensityDifficulty);
  difficulty *= 1 / (1 - Math.pow(0.8, curr.adjustedDeltaTime / 1000));
  return difficulty;
}

function densityDifficulty(nextObj: OsuDifficultyHitObject | null, velocity: number, constantAngleNerf: number, pastInfluence: number, visibleDensity: number): number {
  let futureInfluence = Math.sqrt(visibleDensity);
  if (nextObj) futureInfluence *= smootherstep(nextObj.lazyJumpDistance, 15, DISTANCE_INFLUENCE_THRESHOLD);
  let d = Math.pow(pastInfluence + futureInfluence, 1.7) * 0.4 * constantAngleNerf * velocity;
  d = Math.max(0, d - 2.5);
  return Math.pow(d, 0.45) * 2.4;
}

function preemptDifficultyOf(velocity: number, constantAngleNerf: number, preempt: number): number {
  let d = Math.pow((500 - preempt + Math.abs(preempt - 500)) / 2, 2.5) / 140000;
  d *= constantAngleNerf * velocity;
  return d;
}

function pastObjectDifficultyInfluence(curr: OsuDifficultyHitObject): number {
  let influence = 0;
  for (let i = 0; i < curr.index; i++) {
    const loopObj = curr.previous(i);
    if (!loopObj || curr.startTime - loopObj.startTime > READING_WINDOW_SIZE || loopObj.startTime < curr.startTime - curr.preempt) break;
    let loopDifficulty = curr.opacityAt(loopObj.baseObject.startTime);
    loopDifficulty *= smootherstep(loopObj.lazyJumpDistance, 15, DISTANCE_INFLUENCE_THRESHOLD);
    loopDifficulty *= timeNerfFactor(curr.startTime - loopObj.startTime);
    influence += loopDifficulty;
  }
  return influence;
}

function visibleObjectDensity(curr: OsuDifficultyHitObject): number {
  let count = 0;
  let obj = curr.next(0);
  while (obj) {
    if (obj.startTime - curr.startTime > READING_WINDOW_SIZE || curr.startTime < obj.startTime - obj.preempt) break;
    count += obj.opacityAt(curr.baseObject.startTime) * timeNerfFactor(obj.startTime - curr.startTime);
    obj = obj.next(0);
  }
  return count;
}

function constantAngleNerfFactor(current: OsuDifficultyHitObject): number {
  const minimumAngleRelevancyTime = 2000;
  const maximumAngleRelevancyTime = 200;
  let constantAngleCount = 0;
  let index = 0;
  let currentTimeGap = 0;
  let prev0: OsuDifficultyHitObject = current;
  let prev1: OsuDifficultyHitObject | null = null;
  let prev2: OsuDifficultyHitObject | null = null;
  while (currentTimeGap < minimumAngleRelevancyTime) {
    const loopObj = current.previous(index);
    if (!loopObj) break;
    const longIntervalFactor = 1 - reverseLerp(loopObj.adjustedDeltaTime, maximumAngleRelevancyTime, minimumAngleRelevancyTime);
    if (loopObj.angle !== null && current.angle !== null) {
      const angleDifference = Math.abs(current.angle - loopObj.angle);
      let angleDifferenceAlternating = Math.PI;
      if (prev0.angle !== null && prev1?.angle != null && prev2?.angle != null) {
        angleDifferenceAlternating = Math.abs(prev1.angle - loopObj.angle);
        angleDifferenceAlternating += Math.abs(prev2.angle - prev0.angle);
        let weight = 1;
        weight *= reverseLerp((Math.min(loopObj.angle, prev0.angle) * 180) / Math.PI, 20, 5);
        weight *= reverseLerp((Math.max(loopObj.angle, prev0.angle) * 180) / Math.PI, 60, 120);
        angleDifferenceAlternating = dotnetLerp(Math.PI, 0.1 * angleDifferenceAlternating, weight);
      }
      const stackFactor = smootherstep(loopObj.lazyJumpDistance, 0, NORMALISED_RADIUS);
      constantAngleCount += Math.cos(3 * Math.min(degToRad(30), Math.min(angleDifference, angleDifferenceAlternating) * stackFactor)) * longIntervalFactor;
    }
    currentTimeGap = current.startTime - loopObj.startTime;
    index++;
    prev2 = prev1;
    prev1 = prev0;
    prev0 = loopObj;
  }
  return clamp(2 / constantAngleCount, 0.2, 1);
}

// --- Skills ---

class Aim extends VariableLengthStrainSkill<OsuDifficultyHitObject> {
  private currentStrain = 0;

  constructor(private readonly includeSliders: boolean) {
    super();
  }

  private strainDecay(ms: number) {
    return Math.pow(0.2, ms / 1000);
  }

  protected calculateInitialStrain(time: number, current: OsuDifficultyHitObject): number {
    return this.currentStrain * this.strainDecay(time - current.previous(0)!.startTime);
  }

  protected strainValueAt(current: OsuDifficultyHitObject): number {
    const decay = this.strainDecay(current.adjustedDeltaTime);
    this.currentStrain *= decay;
    this.currentStrain += this.adjustedDifficulty(current) * (1 - decay);
    return this.currentStrain;
  }

  private adjustedDifficulty(current: OsuDifficultyHitObject): number {
    const snap = snapAim(current, this.includeSliders) * 70.9;
    const agile = agility(current) * 2.35;
    const flow = flowAim(current, this.includeSliders) * 242.0;
    const combinedSnap = norm(1.2, snap, agile);
    const pSnap = snapFlowProbability(flow / combinedSnap);
    const total = (combinedSnap * pSnap + flow * (1 - pSnap)) * 1.12;
    return total * (0.985 + Math.pow(Math.max(0, current.overallDifficulty), 2) / 4000);
  }

  difficultyValue(): number {
    let difficulty = 0;
    let time = 0;
    for (const strain of this.reducedStrainPeaks()) {
      const startTime = time;
      const endTime = time + strain.sectionLength / this.maxSectionLength;
      const weight = Math.pow(this.decayWeight, startTime) - Math.pow(this.decayWeight, endTime);
      difficulty += strain.value * weight;
      time = endTime;
    }
    return difficulty / (1 - this.decayWeight);
  }

  private reducedStrainPeaks(): StrainPeak[] {
    const reducedSectionTime = 4000;
    const reducedStrainBaseline = 0.727;
    const chunkSize = 20;
    const strains = this.currentStrainPeaks().filter((p) => p.value > 0);
    let time = 0;
    let skipCount = 0;
    while (strains.length > skipCount && time < reducedSectionTime) {
      const strain = strains[skipCount];
      for (let addedTime = 0; addedTime < strain.sectionLength; addedTime += chunkSize) {
        const s = Math.log10(lerp(1, 10, clamp((time + addedTime) / reducedSectionTime, 0, 1)));
        strains.push({ value: strain.value * lerp(reducedStrainBaseline, 1, s), sectionLength: Math.round(Math.min(chunkSize, strain.sectionLength - addedTime)) });
      }
      time += strain.sectionLength;
      skipCount++;
    }
    return strains.slice(skipCount).sort((a, b) => b.value - a.value);
  }
}

function snapFlowProbability(ratio: number): number {
  if (ratio === 0) return 0;
  if (Number.isNaN(ratio)) return 1;
  return logisticExp(-7.27 * Math.log(ratio));
}

class Speed extends HarmonicSkill<OsuDifficultyHitObject> {
  private currentStrain = 0;
  protected harmonicScale = 20;
  protected decayExponent = 0.9;

  protected objectDifficultyOf(current: OsuDifficultyHitObject): number {
    const decay = Math.pow(0.3, current.adjustedDeltaTime / 1000);
    this.currentStrain *= decay;
    this.currentStrain += speedDifficulty(current) * (1 - decay) * 1.16;
    return this.currentStrain * rhythm(current);
  }
}

class Reading extends HarmonicSkill<OsuDifficultyHitObject> {
  private currentStrain = 0;
  private reducedNoteCount = 0;
  private reducedDuration: number | null = null;

  protected objectDifficultyOf(current: OsuDifficultyHitObject): number {
    const decay = Math.pow(0.8, current.deltaTime / 1000);
    this.currentStrain *= decay;
    this.currentStrain += this.adjustedDifficulty(current) * (1 - decay) * 2.5;
    this.reducedDuration ??= current.startTime + 60 * 1000;
    if (current.startTime <= this.reducedDuration) this.reducedNoteCount++;
    return this.currentStrain;
  }

  private adjustedDifficulty(current: OsuDifficultyHitObject): number {
    return reading(current) * (0.825 + Math.pow(Math.max(0, current.overallDifficulty), 2.2) / 1125.0);
  }

  protected transformedDifficulties(difficulties: number[]): number[] {
    const out = difficulties.filter((v) => v > 0);
    for (let i = 0; i < Math.min(out.length, this.reducedNoteCount); i++) {
      const s = Math.log10(lerp(1, 10, clamp(i / this.reducedNoteCount, 0, 1)));
      out[i] *= lerp(0, 1, s);
    }
    return out;
  }
}

export interface OsuDifficulty {
  starRating: number;
  aim: number;
  speed: number;
  reading: number;
}

export function osuDifficulty(bm: Beatmap, clockRate = 1): OsuDifficulty {
  const map = convertOsu(bm);
  if (map.objects.length === 0) return { starRating: 0, aim: 0, speed: 0, reading: 0 };
  const objects: OsuDifficultyHitObject[] = [];
  for (let i = 1; i < map.objects.length; i++) objects.push(new OsuDifficultyHitObject(map.objects[i], map.objects[i - 1], clockRate, objects, objects.length, map));
  const aim = new Aim(true);
  const speed = new Speed();
  const readingSkill = new Reading();
  for (const o of objects) {
    aim.process(o);
    speed.process(o);
    readingSkill.process(o);
  }
  const aimRating = Math.pow(aim.difficultyValue(), 0.63) * 0.02275;
  const speedRating = Math.sqrt(speed.difficultyValue()) * 0.0675;
  const readingRating = Math.sqrt(readingSkill.difficultyValue()) * 0.0675;
  const basePerformance = norm(
    PERFORMANCE_NORM_EXPONENT,
    harmonicDifficultyToPerformance(aimRating),
    harmonicDifficultyToPerformance(speedRating),
    harmonicDifficultyToPerformance(readingRating),
  );
  return { starRating: Math.cbrt(basePerformance * PERFORMANCE_BASE_MULTIPLIER), aim: aimRating, speed: speedRating, reading: readingRating };
}

