// osu!mania star rating, ported from lazer's osu.Game.Rulesets.Mania/Difficulty (ppy/osu 2026.730.0,
// difficulty calculator version 20241007). Native mania maps only (no converts), no mods.
import type { Beatmap } from '../types';
import { controlPoints, difficultyPointAt, difficultySettings, legacyPosition, legacySliderPath, timeOffset, timingPointAt } from './objects';
import { DifficultyHitObject, roundHalfEven, StrainDecaySkill } from './skills';
import { f32 } from './vec';

const MAX_STAGE_KEYS = 10;

interface ManiaObject {
  startTime: number;
  endTime: number;
  column: number;
}

/** osu.Game.Utils.LegacyRandom (xorshift, as in osu!stable). */
class LegacyRandom {
  private x: number;
  private y = 842502087;
  private z = 3579807591;
  private w = 273326509;

  constructor(seed: number) {
    this.x = seed >>> 0;
  }

  nextUInt(): number {
    const t = (this.x ^ (this.x << 11)) >>> 0;
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return this.w;
  }

  nextDouble(): number {
    return (1 / (2147483647 + 1)) * (this.nextUInt() & 0x7fffffff);
  }

  next(lowerBound: number, upperBound: number): number {
    return Math.trunc(lowerBound + this.nextDouble() * (upperBound - lowerBound));
  }
}

function totalColumns(cs: number): number {
  let target = Math.max(1, roundHalfEven(cs));
  let dual = false;
  if (target > MAX_STAGE_KEYS) {
    target = Math.trunc(target / 2);
    dual = true;
  }
  return target * (dual ? 2 : 1);
}

/** ManiaBeatmapConverter for maps made for mania: notes and holds pass through, spinners get a random column. */
function maniaObjects(bm: Beatmap, columns: number): ManiaObject[] {
  const diff = difficultySettings(bm);
  const cp = controlPoints(bm);
  const offset = timeOffset(bm);
  const seed =
    Math.trunc(roundHalfEven(f32(diff.drainRate + diff.circleSize))) * 20 + Math.trunc(diff.overallDifficulty * 41.2) + Math.trunc(roundHalfEven(diff.approachRate));
  const random = new LegacyRandom(seed);
  const columnOf = (x: number) => Math.min(Math.max(Math.floor(f32(x / f32(512 / columns))), 0), columns - 1);
  const out: ManiaObject[] = [];
  const sorted = [...bm.hitObjects].sort((a, b) => a.time - b.time);
  for (const h of sorted) {
    const startTime = h.time + offset;
    const x = legacyPosition(h, bm.formatVersion).x;
    switch (h.kind) {
      case 'circle':
        out.push({ startTime, endTime: startTime, column: columnOf(x) });
        break;
      case 'hold':
        out.push({ startTime, endTime: startTime + (Math.max(startTime, h.endTime) + offset - startTime), column: columnOf(x) });
        break;
      case 'slider': {
        const path = legacySliderPath(h, bm.formatVersion, legacyPosition(h, bm.formatVersion), false);
        const spans = Math.abs(path.distance) <= 1e-7 ? 1 : Math.max(1, h.slides);
        const velocity = (100 * diff.sliderMultiplier * difficultyPointAt(cp, startTime).sliderVelocity) / timingPointAt(cp, startTime).beatLength;
        out.push({ startTime, endTime: startTime + (spans * path.distance) / velocity, column: columnOf(x) });
        break;
      }
      case 'spinner': {
        const endTime = Math.trunc(startTime + Math.max(0, h.endTime + offset - startTime));
        const finish = (h.hitSound & 4) !== 0;
        const column = columns === 8 && finish && endTime - startTime < 1000 ? 0 : random.next(columns === 8 ? 1 : 0, columns);
        out.push({ startTime, endTime: endTime - startTime >= 100 ? endTime : startTime, column });
        break;
      }
    }
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

/** LegacySortHelper: the .NET Framework introsort lazer keeps so chord order matches stable. */
function legacySort<T>(keys: T[], compare: (a: T, b: T) => number) {
  if (keys.length === 0) return;
  const swapIfGreater = (a: number, b: number) => {
    if (a !== b && compare(keys[a], keys[b]) > 0) [keys[a], keys[b]] = [keys[b], keys[a]];
  };
  const downHeap = (i: number, n: number, lo: number) => {
    const d = keys[lo + i - 1];
    while (i <= n >> 1) {
      let child = 2 * i;
      if (child < n && compare(keys[lo + child - 1], keys[lo + child]) < 0) child++;
      if (!(compare(d, keys[lo + child - 1]) < 0)) break;
      keys[lo + i - 1] = keys[lo + child - 1];
      i = child;
    }
    keys[lo + i - 1] = d;
  };
  const heapsort = (lo: number, hi: number) => {
    const n = hi - lo + 1;
    for (let i = n >> 1; i >= 1; i--) downHeap(i, n, lo);
    for (let i = n; i > 1; i--) {
      if (lo !== lo + i - 1) [keys[lo], keys[lo + i - 1]] = [keys[lo + i - 1], keys[lo]];
      downHeap(1, i - 1, lo);
    }
  };
  const quickSort = (left: number, right: number, depthLimit: number) => {
    do {
      if (depthLimit === 0) {
        heapsort(left, right);
        return;
      }
      let i = left;
      let j = right;
      const middle = i + ((j - i) >> 1);
      swapIfGreater(i, middle);
      swapIfGreater(i, j);
      swapIfGreater(middle, j);
      const x = keys[middle];
      do {
        while (compare(keys[i], x) < 0) i++;
        while (compare(x, keys[j]) < 0) j--;
        if (i > j) break;
        if (i < j) [keys[i], keys[j]] = [keys[j], keys[i]];
        i++;
        j--;
      } while (i <= j);
      depthLimit--;
      if (j - left <= right - i) {
        if (left < j) quickSort(left, j, depthLimit);
        left = i;
      } else {
        if (i < right) quickSort(i, right, depthLimit);
        right = j;
      }
    } while (left < right);
  };
  quickSort(0, keys.length - 1, 32);
}

const times = { start: (o: ManiaObject) => o.startTime, end: (o: ManiaObject) => o.endTime };
const definitelyBigger = (a: number, b: number, eps: number) => a - eps > b;

class ManiaDifficultyHitObject extends DifficultyHitObject<ManiaObject> {
  readonly column: number;
  private readonly columnIndex: number;
  readonly previousHitObjects: (ManiaDifficultyHitObject | null)[];
  readonly columnStrainTime: number;

  constructor(hitObject: ManiaObject, lastObject: ManiaObject, clockRate: number, objects: ManiaDifficultyHitObject[], private readonly perColumn: ManiaDifficultyHitObject[][], index: number) {
    super(hitObject, lastObject, clockRate, objects as DifficultyHitObject<ManiaObject>[], index, times);
    this.column = hitObject.column;
    this.columnIndex = perColumn[this.column].length;
    this.previousHitObjects = new Array(perColumn.length).fill(null);
    const prevInColumn = this.prevInColumn(0);
    this.columnStrainTime = prevInColumn ? this.startTime - prevInColumn.startTime : this.startTime;
    if (index > 0) {
      const prevNote = objects[index - 1];
      for (let i = 0; i < prevNote.previousHitObjects.length; i++) this.previousHitObjects[i] = prevNote.previousHitObjects[i];
      this.previousHitObjects[prevNote.column] = prevNote;
    }
  }

  prevInColumn(n: number): ManiaDifficultyHitObject | null {
    const i = this.columnIndex - (n + 1);
    const list = this.perColumn[this.column];
    return i >= 0 && i < list.length ? list[i] : null;
  }
}

function individualStrain(current: ManiaDifficultyHitObject): number {
  let holdFactor = 1;
  for (const prev of current.previousHitObjects) {
    if (!prev) continue;
    if (definitelyBigger(prev.endTime, current.endTime, 1) && definitelyBigger(current.startTime, prev.startTime, 1)) {
      holdFactor = 1.25;
      break;
    }
  }
  return 2 * holdFactor;
}

function overallStrain(current: ManiaDifficultyHitObject): number {
  const { startTime, endTime } = current;
  let isOverlapping = false;
  let closestEndTime = Math.abs(endTime - startTime);
  let holdFactor = 1;
  let holdAddition = 0;
  for (const prev of current.previousHitObjects) {
    if (!prev) continue;
    isOverlapping ||= definitelyBigger(prev.endTime, startTime, 1) && definitelyBigger(endTime, prev.endTime, 1) && definitelyBigger(startTime, prev.startTime, 1);
    if (definitelyBigger(prev.endTime, endTime, 1) && definitelyBigger(startTime, prev.startTime, 1)) holdFactor = 1.25;
    closestEndTime = Math.min(closestEndTime, Math.abs(endTime - prev.endTime));
  }
  if (isOverlapping) holdAddition = 1 / (1 + Math.exp(0.27 * (30 - closestEndTime)));
  return (1 + holdAddition) * holdFactor;
}

class Strain extends StrainDecaySkill<ManiaDifficultyHitObject> {
  protected skillMultiplier = 1;
  protected strainDecayBase = 1;
  private readonly individualStrains: number[];
  private highestIndividualStrain = 0;
  private overall = 1;

  constructor(columns: number) {
    super();
    this.individualStrains = new Array(columns).fill(0);
  }

  private applyDecay(value: number, deltaTime: number, decayBase: number) {
    return value * Math.pow(decayBase, deltaTime / 1000);
  }

  protected strainValueOf(current: ManiaDifficultyHitObject): number {
    const s = this.individualStrains;
    s[current.column] = this.applyDecay(s[current.column], current.columnStrainTime, 0.125);
    s[current.column] += individualStrain(current);
    this.highestIndividualStrain = current.deltaTime <= 1 ? Math.max(this.highestIndividualStrain, s[current.column]) : s[current.column];
    this.overall = this.applyDecay(this.overall, current.deltaTime, 0.3);
    this.overall += overallStrain(current);
    return this.highestIndividualStrain + this.overall - this.currentStrain;
  }

  protected calculateInitialStrain(offset: number, current: ManiaDifficultyHitObject): number {
    const dt = offset - current.previous(0)!.startTime;
    return this.applyDecay(this.highestIndividualStrain, dt, 0.125) + this.applyDecay(this.overall, dt, 0.3);
  }
}

export function maniaStarRating(bm: Beatmap, clockRate = 1): number {
  if (bm.hitObjects.length === 0) return 0;
  const columns = totalColumns(difficultySettings(bm).circleSize);
  const sorted = maniaObjects(bm, columns);
  legacySort(sorted, (a, b) => roundHalfEven(a.startTime) - roundHalfEven(b.startTime));
  const objects: ManiaDifficultyHitObject[] = [];
  const perColumn: ManiaDifficultyHitObject[][] = Array.from({ length: columns }, () => []);
  for (let i = 1; i < sorted.length; i++) {
    const o = new ManiaDifficultyHitObject(sorted[i], sorted[i - 1], clockRate, objects, perColumn, objects.length);
    objects.push(o);
    perColumn[o.column].push(o);
  }
  const strain = new Strain(columns);
  for (const o of objects) strain.process(o);
  return strain.difficultyValue() * 0.018;
}
