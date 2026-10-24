// Shared difficulty-calculation building blocks, ported from lazer
// (osu.Game/Rulesets/Difficulty: DiffUtils, DifficultyHitObject and the Skills base classes).
import { binarySearch } from './vec';

// --- DiffUtils ---

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const lerp = (start: number, end: number, amount: number) => start + (end - start) * amount;
/** .NET's double.Lerp. */
export const dotnetLerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
export const bpmToMilliseconds = (bpm: number, delimiter = 4) => 60000 / delimiter / bpm;
export const millisecondsToBpm = (ms: number, delimiter = 4) => 60000 / (ms * delimiter);
export const logistic = (x: number, midpointOffset: number, multiplier: number, maxValue = 1) => maxValue / (1 + Math.exp(multiplier * (midpointOffset - x)));
export const logisticExp = (exponent: number, maxValue = 1) => maxValue / (1 + Math.exp(exponent));
export const degToRad = (d: number) => (d * Math.PI) / 180;

export function norm(p: number, ...values: number[]): number {
  let sum = 0;
  for (const x of values) sum += Math.pow(x, p);
  return Math.pow(sum, 1 / p);
}

export function smoothstep(x: number, start: number, end: number): number {
  x = clamp((x - start) / (end - start), 0, 1);
  return x * x * (3 - 2 * x);
}

export function smootherstep(x: number, start: number, end: number): number {
  x = clamp((x - start) / (end - start), 0, 1);
  return x * x * x * (x * (6 * x - 15) + 10);
}

export function smoothstepBellCurve(x: number): number {
  x = 0.5 - Math.abs(x - 0.5);
  x = clamp(x * 2, 0, 1);
  return x * x * (3 - 2 * x);
}

export const reverseLerp = (x: number, start: number, end: number) => clamp((x - start) / (end - start), 0, 1);

export function erf(x: number): number {
  if (x === 0) return 0;
  if (x === Infinity) return 1;
  if (x === -Infinity) return -1;
  if (Number.isNaN(x)) return NaN;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const tau = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const e = 1 - tau * Math.exp(-x * x);
  return x >= 0 ? e : -e;
}

/** Stable descending sort, like LINQ's OrderDescending. */
export const sortedDescending = (values: Iterable<number>) => Array.from(values).sort((a, b) => b - a);

// --- DifficultyHitObject ---

export class DifficultyHitObject<T = unknown> {
  readonly deltaTime: number;
  readonly startTime: number;
  readonly endTime: number;

  constructor(
    readonly baseObject: T,
    readonly lastObject: T,
    readonly clockRate: number,
    protected readonly objects: DifficultyHitObject<T>[],
    readonly index: number,
    times: { start: (o: T) => number; end: (o: T) => number },
  ) {
    this.deltaTime = (times.start(baseObject) - times.start(lastObject)) / clockRate;
    this.startTime = times.start(baseObject) / clockRate;
    this.endTime = times.end(baseObject) / clockRate;
  }

  previous(skip = 0): this | null {
    const i = this.index - (skip + 1);
    return i >= 0 && i < this.objects.length ? (this.objects[i] as this) : null;
  }

  next(skip = 0): this | null {
    const i = this.index + (skip + 1);
    return i >= 0 && i < this.objects.length ? (this.objects[i] as this) : null;
  }
}

// --- Skills ---

export abstract class Skill<H extends DifficultyHitObject = DifficultyHitObject> {
  readonly objectDifficulties: number[] = [];

  process(current: H) {
    this.objectDifficulties.push(this.processInternal(current));
  }

  protected abstract processInternal(current: H): number;
  abstract difficultyValue(): number;
}

/** Fixed 400 ms sections, each contributing its peak strain to a geometric sum. */
export abstract class StrainSkill<H extends DifficultyHitObject = DifficultyHitObject> extends Skill<H> {
  protected decayWeight = 0.9;
  protected sectionLength = 400;
  private currentSectionPeak = 0;
  private currentSectionEnd = 0;
  protected readonly strainPeaks: number[] = [];

  protected abstract strainValueAt(current: H): number;
  protected abstract calculateInitialStrain(time: number, current: H): number;

  protected processInternal(current: H): number {
    if (current.index === 0) this.currentSectionEnd = Math.ceil(current.startTime / this.sectionLength) * this.sectionLength;
    while (current.startTime > this.currentSectionEnd) {
      this.strainPeaks.push(this.currentSectionPeak);
      this.currentSectionPeak = this.calculateInitialStrain(this.currentSectionEnd, current);
      this.currentSectionEnd += this.sectionLength;
    }
    const strain = this.strainValueAt(current);
    this.currentSectionPeak = Math.max(strain, this.currentSectionPeak);
    return strain;
  }

  currentStrainPeaks(): number[] {
    return [...this.strainPeaks, this.currentSectionPeak];
  }

  countTopWeightedStrains(difficultyValue: number): number {
    if (this.objectDifficulties.length === 0) return 0;
    const consistentTopStrain = difficultyValue * (1 - this.decayWeight);
    if (consistentTopStrain === 0) return this.objectDifficulties.length;
    let sum = 0;
    for (const s of this.objectDifficulties) sum += logistic(s / consistentTopStrain, 0.88, 10, 1.1);
    return sum;
  }

  difficultyValue(): number {
    let difficulty = 0;
    let weight = 1;
    for (const strain of sortedDescending(this.currentStrainPeaks().filter((p) => p > 0))) {
      difficulty += strain * weight;
      weight *= this.decayWeight;
    }
    return difficulty;
  }
}

export abstract class StrainDecaySkill<H extends DifficultyHitObject = DifficultyHitObject> extends StrainSkill<H> {
  protected abstract skillMultiplier: number;
  protected abstract strainDecayBase: number;
  protected currentStrain = 0;

  protected calculateInitialStrain(time: number, current: H): number {
    return this.currentStrain * this.strainDecay(time - current.previous(0)!.startTime);
  }

  protected strainValueAt(current: H): number {
    this.currentStrain *= this.strainDecay(current.deltaTime);
    this.currentStrain += this.strainValueOf(current) * this.skillMultiplier;
    return this.currentStrain;
  }

  protected abstract strainValueOf(current: H): number;

  private strainDecay(ms: number) {
    return Math.pow(this.strainDecayBase, ms / 1000);
  }
}

/** Sums every object's difficulty with harmonic weights instead of sectioned peaks. */
export abstract class HarmonicSkill<H extends DifficultyHitObject = DifficultyHitObject> extends Skill<H> {
  protected objectWeightSum = 0;
  protected harmonicScale = 1;
  protected decayExponent = 0.9;

  protected abstract objectDifficultyOf(current: H): number;

  protected processInternal(current: H): number {
    return this.objectDifficultyOf(current);
  }

  protected transformedDifficulties(difficulties: number[]): number[] {
    return difficulties;
  }

  difficultyValue(): number {
    this.objectWeightSum = 0;
    if (this.objectDifficulties.length === 0) return 0;
    const sorted = sortedDescending(this.transformedDifficulties(this.objectDifficulties)).filter((v) => v > 0);
    let difficulty = 0;
    for (let index = 0; index < sorted.length; index++) {
      const h = this.harmonicScale / (1 + index);
      const weight = (1 + h) / (Math.pow(index, this.decayExponent) + 1 + h);
      this.objectWeightSum += weight;
      difficulty += sorted[index] * weight;
    }
    return difficulty;
  }

  countTopWeightedObjectDifficulties(difficultyValue: number): number {
    if (this.objectDifficulties.length === 0 || this.objectWeightSum === 0) return 0;
    const consistentTopObject = difficultyValue / this.objectWeightSum;
    if (consistentTopObject === 0) return 0;
    let sum = 0;
    for (const d of this.objectDifficulties) sum += logistic(d / consistentTopObject, 0.88, 10, 1.1);
    return sum;
  }
}

export const harmonicDifficultyToPerformance = (difficulty: number) => 4 * Math.pow(difficulty, 3);

export interface StrainPeak {
  value: number;
  sectionLength: number;
}

const makePeak = (value: number, sectionLength: number): StrainPeak => ({ value, sectionLength: roundHalfEven(sectionLength) });
/** Reverse sort: highest first. */
const comparePeaks = (a: StrainPeak, b: StrainPeak) => (b.value < a.value ? -1 : b.value > a.value ? 1 : 0);

/** Math.Round (banker's rounding). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Like StrainSkill, but a new section starts at every object that raises the peak, so sections vary in length. */
export abstract class VariableLengthStrainSkill<H extends DifficultyHitObject = DifficultyHitObject> extends Skill<H> {
  private currentSectionPeak = 0;
  private currentSectionBegin = 0;
  private currentSectionEnd = 0;
  private readonly maxStoredLength: number;
  private readonly strainPeaks: StrainPeak[] = [];
  private totalLength = 0;
  private readonly queuedStrains: { strain: number; startTime: number }[] = [];
  private finalPeak: StrainPeak | null = null;

  constructor(
    protected readonly decayWeight = 0.9,
    protected readonly maxSectionLength = 400,
  ) {
    super();
    this.maxStoredLength = 11 / (1 - decayWeight);
  }

  protected abstract strainValueAt(current: H): number;
  protected abstract calculateInitialStrain(time: number, current: H): number;

  protected processInternal(current: H): number {
    if (current.index === 0) {
      this.currentSectionBegin = current.startTime;
      this.currentSectionEnd = this.currentSectionBegin + this.maxSectionLength;
      this.currentSectionPeak = this.strainValueAt(current);
      return this.currentSectionPeak;
    }
    this.backfillPeaks(current);
    const currentStrain = this.strainValueAt(current);
    if (currentStrain > this.currentSectionPeak) {
      this.queuedStrains.length = 0;
      this.saveCurrentPeak(current.startTime - this.currentSectionBegin);
      this.currentSectionBegin = current.startTime;
      this.currentSectionEnd = this.currentSectionBegin + this.maxSectionLength;
      this.currentSectionPeak = currentStrain;
    } else {
      while (this.queuedStrains.length > 0 && this.queuedStrains[this.queuedStrains.length - 1].strain < currentStrain) this.queuedStrains.pop();
      this.queuedStrains.push({ strain: currentStrain, startTime: current.startTime });
    }
    return currentStrain;
  }

  private backfillPeaks(current: H) {
    while (current.startTime > this.currentSectionEnd) {
      this.saveCurrentPeak(this.currentSectionEnd - this.currentSectionBegin);
      this.currentSectionBegin = this.currentSectionEnd;
      const queued = this.queuedStrains.shift();
      if (queued) {
        this.currentSectionEnd = queued.startTime + this.maxSectionLength;
        this.currentSectionPeak = this.calculateInitialStrain(this.currentSectionBegin, current);
        this.currentSectionPeak = Math.max(this.currentSectionPeak, queued.strain);
      } else {
        this.currentSectionEnd = this.currentSectionBegin + this.maxSectionLength;
        this.currentSectionPeak = this.calculateInitialStrain(this.currentSectionBegin, current);
      }
    }
  }

  private saveCurrentPeak(sectionLength: number) {
    if (this.finalPeak) {
      this.removePeak(this.finalPeak);
      this.finalPeak = null;
    }
    const peak = makePeak(this.currentSectionPeak, sectionLength);
    this.addPeakInPlace(peak);
    this.totalLength += sectionLength;
    while (this.totalLength > this.maxStoredLength * this.maxSectionLength) {
      this.totalLength -= this.strainPeaks[this.strainPeaks.length - 1].sectionLength;
      this.strainPeaks.pop();
    }
  }

  private addPeakInPlace(peak: StrainPeak) {
    let index = binarySearch(this.strainPeaks, peak, comparePeaks);
    if (index < 0) index = ~index;
    this.strainPeaks.splice(index, 0, peak);
  }

  private removePeak(peak: StrainPeak) {
    const i = this.strainPeaks.findIndex((p) => p.value === peak.value && p.sectionLength === peak.sectionLength);
    if (i >= 0) this.strainPeaks.splice(i, 1);
  }

  /** Strain peaks sorted highest first, including the current section. */
  currentStrainPeaks(): StrainPeak[] {
    if (!this.finalPeak) {
      this.finalPeak = makePeak(this.currentSectionPeak, this.currentSectionEnd - this.currentSectionBegin);
      this.addPeakInPlace(this.finalPeak);
    }
    return this.strainPeaks;
  }

  countTopWeightedStrains(difficultyValue: number): number {
    if (this.objectDifficulties.length === 0) return 0;
    const consistentTopStrain = difficultyValue * (1 - this.decayWeight);
    if (consistentTopStrain === 0) return this.objectDifficulties.length;
    let sum = 0;
    for (const s of this.objectDifficulties) sum += logistic(s / consistentTopStrain, 0.88, 10, 1.1);
    return sum;
  }
}
