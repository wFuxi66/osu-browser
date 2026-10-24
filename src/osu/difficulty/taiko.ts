// osu!taiko star rating, ported from lazer's osu.Game.Rulesets.Taiko/Difficulty (ppy/osu 2026.730.0,
// difficulty calculator version 20260706). Native taiko maps only (no converts), no mods.
import type { Beatmap } from '../types';
import { clamp as clampNum, controlPoints, difficultyRange, difficultySettings, lastAtOrBefore, timeOffset, timingPointAt } from './objects';
import { DifficultyHitObject, logistic, logisticExp, norm, reverseLerp, roundHalfEven, smootherstep, sortedDescending, StrainDecaySkill, StrainSkill } from './skills';

type HitType = 'centre' | 'rim';

interface TaikoObject {
  kind: 'hit' | 'drumroll' | 'swell';
  type: HitType | null;
  startTime: number;
}

const MARGIN_OF_ERROR = 5;
const almostEquals = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;
const times = { start: (o: TaikoObject) => o.startTime, end: (o: TaikoObject) => o.startTime };

class TaikoDifficultyHitObject extends DifficultyHitObject<TaikoObject> {
  readonly monoIndex: number = 0;
  readonly noteIndex: number = 0;
  private readonly monoObjects: TaikoDifficultyHitObject[] | null = null;
  readonly rhythm: RhythmData;
  readonly colour: ColourData = { monoStreak: null, alternatingMonoPattern: null, repeatingHitPattern: null };
  readonly effectiveBpm: number;
  readonly hitWindowGreat: number;

  constructor(
    hitObject: TaikoObject,
    lastObject: TaikoObject,
    clockRate: number,
    objects: TaikoDifficultyHitObject[],
    centre: TaikoDifficultyHitObject[],
    rim: TaikoDifficultyHitObject[],
    private readonly notes: TaikoDifficultyHitObject[],
    index: number,
    ctx: { greatWindow: number; bpmAt: (t: number) => number; scrollSpeedAt: (t: number) => number; sliderMultiplier: number },
  ) {
    super(hitObject, lastObject, clockRate, objects as DifficultyHitObject<TaikoObject>[], index, times);
    this.hitWindowGreat = (2 * ctx.greatWindow) / clockRate;
    this.rhythm = new RhythmData(this);
    if (hitObject.kind === 'hit') {
      const mono = hitObject.type === 'centre' ? centre : rim;
      this.monoIndex = mono.length;
      mono.push(this);
      this.monoObjects = mono;
      this.noteIndex = notes.length;
      notes.push(this);
    }
    const normalisedStartTime = this.startTime * clockRate;
    this.effectiveBpm = ctx.bpmAt(normalisedStartTime) * ctx.sliderMultiplier * ctx.scrollSpeedAt(normalisedStartTime) * clockRate;
  }

  get isHit() {
    return this.baseObject.kind === 'hit';
  }

  get interval() {
    return this.deltaTime;
  }

  previousMono(n: number) {
    return this.monoObjects?.[this.monoIndex - (n + 1)] ?? null;
  }

  previousNote(n: number) {
    return this.notes[this.noteIndex - (n + 1)] ?? null;
  }

  nextNote(n: number) {
    return this.notes[this.noteIndex + (n + 1)] ?? null;
  }
}

// --- Rhythm preprocessing ---

const COMMON_RATIOS = [1 / 1, 2 / 1, 1 / 2, 3 / 1, 1 / 3, 3 / 2, 2 / 3, 5 / 4, 4 / 5];

class RhythmData {
  sameRhythm: SameRhythmGroup | null = null;
  samePatterns: SamePatternsGroup | null = null;
  readonly ratio: number;

  constructor(current: TaikoDifficultyHitObject) {
    const previous = current.previous(0);
    if (!previous) {
      this.ratio = 1;
      return;
    }
    const actual = current.deltaTime / previous.deltaTime;
    let best = COMMON_RATIOS[0];
    let bestKey = Math.abs(best - actual);
    for (const r of COMMON_RATIOS) {
      const key = Math.abs(r - actual);
      if (key < bestKey) {
        best = r;
        bestKey = key;
      }
    }
    this.ratio = best;
  }
}

interface HasInterval {
  readonly interval: number;
}

/** IntervalGroupingUtils.GroupByInterval. */
function groupByInterval<T extends HasInterval>(objects: T[]): T[][] {
  const groups: T[][] = [];
  let i = 0;
  while (i < objects.length) {
    const group = [objects[i]];
    i++;
    let done = false;
    for (; i < objects.length - 1; i++) {
      if (!almostEquals(objects[i].interval, objects[i + 1].interval, MARGIN_OF_ERROR)) {
        if (objects[i + 1].interval > objects[i].interval + MARGIN_OF_ERROR) {
          group.push(objects[i]);
          i++;
        }
        done = true;
        break;
      }
      group.push(objects[i]);
    }
    if (!done && objects.length > 2 && i < objects.length && almostEquals(objects[objects.length - 1].interval, objects[objects.length - 2].interval, MARGIN_OF_ERROR)) {
      group.push(objects[i]);
      i++;
    }
    groups.push(group);
  }
  return groups;
}

/** DeltaTimeNormaliser.Normalise: snaps each delta time to the median of its cluster. */
function normaliseDeltaTimes(objects: TaikoDifficultyHitObject[], marginOfError: number): Map<TaikoDifficultyHitObject, number> {
  const deltaTimes = [...new Set(objects.map((h) => h.deltaTime))].sort((a, b) => a - b);
  const sets: number[][] = [];
  let current: number[] | null = null;
  for (const value of deltaTimes) {
    if (current && Math.abs(value - current[0]) <= marginOfError) {
      current.push(value);
      continue;
    }
    current = [value];
    sets.push(current);
  }
  const medians = new Map<number, number>();
  for (const set of sets) {
    const mid = set.length >> 1;
    const median = set.length % 2 === 1 ? set[mid] : (set[mid - 1] + set[mid]) / 2;
    for (const v of set) medians.set(v, median);
  }
  return new Map(objects.map((h) => [h, medians.get(h.deltaTime) ?? h.deltaTime]));
}

class SameRhythmGroup implements HasInterval {
  readonly hitObjectInterval: number | null = null;
  readonly hitObjectIntervalRatio: number;
  readonly interval: number = Infinity;

  constructor(
    readonly previous: SameRhythmGroup | null,
    readonly hitObjects: TaikoDifficultyHitObject[],
  ) {
    const normalised = normaliseDeltaTimes(hitObjects, MARGIN_OF_ERROR);
    const deltas = hitObjects.slice(1).map((h) => normalised.get(h)!);
    const modalDelta = deltas.length > 0 ? roundHalfEven(deltas[0]) : 0;
    if (deltas.length > 0) {
      const prev = previous?.hitObjectInterval ?? null;
      this.hitObjectInterval = prev !== null && Math.abs(modalDelta - prev) <= MARGIN_OF_ERROR ? prev : modalDelta;
    }
    const prevInterval = previous?.hitObjectInterval ?? null;
    this.hitObjectIntervalRatio = prevInterval !== null && this.hitObjectInterval !== null ? this.hitObjectInterval / prevInterval : 1;
    if (previous) this.interval = Math.abs(this.startTime - previous.startTime) <= MARGIN_OF_ERROR ? 0 : this.startTime - previous.startTime;
  }

  get firstHitObject() {
    return this.hitObjects[0];
  }

  get startTime() {
    return this.hitObjects[0].startTime;
  }

  get duration() {
    return this.hitObjects[this.hitObjects.length - 1].startTime - this.hitObjects[0].startTime;
  }
}

class SamePatternsGroup {
  constructor(
    readonly previous: SamePatternsGroup | null,
    readonly groups: SameRhythmGroup[],
  ) {}

  get groupInterval(): number {
    return this.groups.length > 1 ? this.groups[1].interval : this.groups[0].interval;
  }

  get intervalRatio(): number {
    return this.previous ? this.groupInterval / this.previous.groupInterval : 1;
  }

  get firstHitObject() {
    return this.groups[0].firstHitObject;
  }
}

function processRhythm(notes: TaikoDifficultyHitObject[]) {
  const rhythmGroups: SameRhythmGroup[] = [];
  for (const grouped of groupByInterval(notes)) rhythmGroups.push(new SameRhythmGroup(rhythmGroups[rhythmGroups.length - 1] ?? null, grouped));
  for (const g of rhythmGroups) for (const h of g.hitObjects) h.rhythm.sameRhythm = g;
  const patternGroups: SamePatternsGroup[] = [];
  for (const grouped of groupByInterval(rhythmGroups)) patternGroups.push(new SamePatternsGroup(patternGroups[patternGroups.length - 1] ?? null, grouped));
  for (const p of patternGroups) for (const g of p.groups) for (const h of g.hitObjects) h.rhythm.samePatterns = p;
}

// --- Colour preprocessing ---

interface ColourData {
  monoStreak: MonoStreak | null;
  alternatingMonoPattern: AlternatingMonoPattern | null;
  repeatingHitPattern: RepeatingHitPatterns | null;
}

class MonoStreak {
  readonly hitObjects: TaikoDifficultyHitObject[] = [];
  parent!: AlternatingMonoPattern;
  index = 0;

  get firstHitObject() {
    return this.hitObjects[0];
  }

  get lastHitObject() {
    return this.hitObjects[this.hitObjects.length - 1];
  }

  get hitType(): HitType | null {
    return this.hitObjects[0].baseObject.kind === 'hit' ? this.hitObjects[0].baseObject.type : null;
  }

  get runLength() {
    return this.hitObjects.length;
  }
}

class AlternatingMonoPattern {
  readonly monoStreaks: MonoStreak[] = [];
  parent!: RepeatingHitPatterns;
  index = 0;

  get firstHitObject() {
    return this.monoStreaks[0].firstHitObject;
  }

  isRepetitionOf(other: AlternatingMonoPattern) {
    return this.hasIdenticalMonoLength(other) && other.monoStreaks.length === this.monoStreaks.length && other.monoStreaks[0].hitType === this.monoStreaks[0].hitType;
  }

  hasIdenticalMonoLength(other: AlternatingMonoPattern) {
    return other.monoStreaks[0].runLength === this.monoStreaks[0].runLength;
  }
}

const MAX_REPETITION_INTERVAL = 16;

class RepeatingHitPatterns {
  readonly alternatingMonoPatterns: AlternatingMonoPattern[] = [];
  repetitionInterval = MAX_REPETITION_INTERVAL + 1;

  constructor(readonly previous: RepeatingHitPatterns | null) {}

  get firstHitObject() {
    return this.alternatingMonoPatterns[0].firstHitObject;
  }

  private isRepetitionOf(other: RepeatingHitPatterns) {
    if (this.alternatingMonoPatterns.length !== other.alternatingMonoPatterns.length) return false;
    for (let i = 0; i < Math.min(this.alternatingMonoPatterns.length, 2); i++) {
      if (!this.alternatingMonoPatterns[i].hasIdenticalMonoLength(other.alternatingMonoPatterns[i])) return false;
    }
    return true;
  }

  findRepetitionInterval() {
    if (!this.previous) {
      this.repetitionInterval = MAX_REPETITION_INTERVAL + 1;
      return;
    }
    let other: RepeatingHitPatterns | null = this.previous;
    let interval = 1;
    while (interval < MAX_REPETITION_INTERVAL) {
      if (this.isRepetitionOf(other)) {
        this.repetitionInterval = Math.min(interval, MAX_REPETITION_INTERVAL);
        return;
      }
      other = other.previous;
      if (!other) break;
      ++interval;
    }
    this.repetitionInterval = MAX_REPETITION_INTERVAL + 1;
  }
}

function processColour(objects: TaikoDifficultyHitObject[]) {
  const monoStreaks: MonoStreak[] = [];
  let currentStreak: MonoStreak | null = null;
  for (const o of objects) {
    const previous = o.previousNote(0);
    const type = o.baseObject.kind === 'hit' ? o.baseObject.type : null;
    const prevType = previous && previous.baseObject.kind === 'hit' ? previous.baseObject.type : null;
    if (!currentStreak || !previous || type !== prevType) {
      currentStreak = new MonoStreak();
      monoStreaks.push(currentStreak);
    }
    currentStreak.hitObjects.push(o);
  }

  const monoPatterns: AlternatingMonoPattern[] = [];
  let currentPattern: AlternatingMonoPattern | null = null;
  for (let i = 0; i < monoStreaks.length; i++) {
    if (!currentPattern || monoStreaks[i].runLength !== monoStreaks[i - 1].runLength) {
      currentPattern = new AlternatingMonoPattern();
      monoPatterns.push(currentPattern);
    }
    currentPattern.monoStreaks.push(monoStreaks[i]);
  }

  const hitPatterns: RepeatingHitPatterns[] = [];
  let currentHitPattern: RepeatingHitPatterns | null = null;
  for (let i = 0; i < monoPatterns.length; i++) {
    currentHitPattern = new RepeatingHitPatterns(currentHitPattern);
    let isCoupled = i < monoPatterns.length - 2 && monoPatterns[i].isRepetitionOf(monoPatterns[i + 2]);
    if (!isCoupled) currentHitPattern.alternatingMonoPatterns.push(monoPatterns[i]);
    else {
      while (isCoupled) {
        currentHitPattern.alternatingMonoPatterns.push(monoPatterns[i]);
        i++;
        isCoupled = i < monoPatterns.length - 2 && monoPatterns[i].isRepetitionOf(monoPatterns[i + 2]);
      }
      currentHitPattern.alternatingMonoPatterns.push(monoPatterns[i], monoPatterns[i + 1]);
      i++;
    }
    hitPatterns.push(currentHitPattern);
  }
  for (const p of hitPatterns) p.findRepetitionInterval();

  for (const p of hitPatterns) {
    p.alternatingMonoPatterns.forEach((mp, i) => {
      mp.parent = p;
      mp.index = i;
      mp.monoStreaks.forEach((ms, j) => {
        ms.parent = mp;
        ms.index = j;
        for (const h of ms.hitObjects) {
          h.colour.repeatingHitPattern = p;
          h.colour.alternatingMonoPattern = mp;
          h.colour.monoStreak = ms;
        }
      });
    });
  }
}

// --- Evaluators ---

function consistentRatioPenalty(hitObject: TaikoDifficultyHitObject, threshold = 0.01, maxObjectsToCheck = 64): number {
  let consistentRatioCount = 0;
  let totalRatioCount = 0;
  const recentRatios: number[] = [];
  let current = hitObject;
  // lazer reads Previous(1) once, outside the loop.
  const previousHitObject = current.previous(1);
  for (let i = 0; i < maxObjectsToCheck; i++) {
    if (current.index <= 1) break;
    const currentRatio = current.rhythm.ratio;
    const previousRatio = previousHitObject!.rhythm.ratio;
    recentRatios.push(currentRatio);
    if (Math.abs(1 - currentRatio / previousRatio) <= threshold) {
      consistentRatioCount++;
      totalRatioCount += currentRatio;
      break;
    }
    current = previousHitObject!;
  }
  if (consistentRatioCount > 0) return 1 - (totalRatioCount / (consistentRatioCount + 1)) * 0.8;
  if (recentRatios.length <= 1) return 1;
  const average = recentRatios.reduce((a, b) => a + b, 0) / recentRatios.length;
  const maxRatioDeviation = Math.max(...recentRatios.map((r) => Math.abs(r - average)));
  return 0.7 + 0.3 * smootherstep(maxRatioDeviation, 0, 1);
}

const repeatingHitPatternsDifficulty = (p: RepeatingHitPatterns) => 2 * (1 - logisticExp(Math.E * p.repetitionInterval - 2 * Math.E));
const alternatingMonoPatternDifficulty = (p: AlternatingMonoPattern) => logisticExp(Math.E * p.index - 2 * Math.E) * repeatingHitPatternsDifficulty(p.parent);
const monoStreakDifficulty = (s: MonoStreak) => logisticExp(Math.E * s.index - 2 * Math.E) * alternatingMonoPatternDifficulty(s.parent) * 0.5;

function colourDifficulty(o: TaikoDifficultyHitObject): number {
  const c = o.colour;
  let difficulty = 0;
  if (c.monoStreak && c.monoStreak.firstHitObject === o) difficulty += monoStreakDifficulty(c.monoStreak);
  if (c.alternatingMonoPattern && c.alternatingMonoPattern.firstHitObject === o) difficulty += alternatingMonoPatternDifficulty(c.alternatingMonoPattern);
  if (c.repeatingHitPattern && c.repeatingHitPattern.firstHitObject === o) difficulty += repeatingHitPatternsDifficulty(c.repeatingHitPattern);
  return difficulty * consistentRatioPenalty(o);
}

function readingDifficulty(o: TaikoDifficultyHitObject): number {
  const high = { min: 480, max: 640 };
  const mid = { min: 360, max: 480 };
  const centre = (r: { min: number; max: number }) => (r.max + r.min) / 2;
  const range = (r: { min: number; max: number }) => r.max - r.min;
  const effectiveBpm = Math.max(1, o.effectiveBpm);
  const midVelocityDifficulty = 0.5 * logistic(effectiveBpm, centre(mid), 1 / (range(mid) / 10));
  const expectedDeltaTime = 21000 / effectiveBpm;
  const objectDensity = expectedDeltaTime / Math.max(1, o.deltaTime);
  const densityPenalty = logistic(objectDensity, 0.925, 15);
  const highVelocityDifficulty = (1 - 0.33 * densityPenalty) * logistic(effectiveBpm, centre(high) + 8 * densityPenalty, (1 + 0.5 * densityPenalty) / (range(high) / 10));
  return midVelocityDifficulty + highVelocityDifficulty;
}

const bellCurve = (x: number, mean: number, width: number, multiplier = 1) => multiplier * Math.exp(Math.E * -(Math.pow(x - mean, 2) / Math.pow(width, 2)));
const isNormal = (x: number) => Number.isFinite(x) && x !== 0 && Math.abs(x) >= 2.2250738585072014e-308;

function ratioDifficulty(ratio: number, terms = 8): number {
  let difficulty = 0;
  ratio = isNormal(ratio) ? ratio : 0;
  for (let i = 1; i <= terms; ++i) difficulty += -1 * Math.pow(Math.cos(i * Math.PI * ratio), 4);
  difficulty += terms / (1 + ratio);
  difficulty += bellCurve(ratio, 1, 0.5);
  difficulty -= bellCurve(ratio, 1, 0.3);
  difficulty = Math.max(difficulty, 0);
  return difficulty / Math.sqrt(8);
}

function repeatedIntervalPenalty(group: SameRhythmGroup, hitWindow: number, threshold = 0.1): number {
  const sameInterval = (start: SameRhythmGroup, intervalCount: number) => {
    const intervals: number[] = [];
    let current: SameRhythmGroup | null = start;
    for (let i = 0; i < intervalCount && current; i++) {
      if (current.hitObjectInterval !== null) intervals.push(current.hitObjectInterval);
      current = current.previous;
    }
    if (intervals.length < intervalCount) return 1;
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        if (Math.abs(1 - intervals[i] / intervals[j]) <= threshold) return 0.8;
      }
    }
    return 1;
  };
  const longIntervalPenalty = sameInterval(group, 3);
  const shortIntervalPenalty = group.hitObjects.length < 6 ? sameInterval(group, 4) : 1;
  const durationPenalty = Math.max(1 - (group.duration * 2) / hitWindow, 0.5);
  return Math.min(longIntervalPenalty, shortIntervalPenalty) * durationPenalty;
}

function sameRhythmDifficulty(group: SameRhythmGroup, hitWindow: number): number {
  let intervalDifficulty = ratioDifficulty(group.hitObjectIntervalRatio);
  const previousInterval = group.previous?.hitObjectInterval ?? null;
  intervalDifficulty *= repeatedIntervalPenalty(group, hitWindow);
  if (previousInterval !== null && group.hitObjects.length > 1) {
    const expectedDurationFromPrevious = previousInterval * group.hitObjects.length;
    const durationDifference = group.duration - expectedDurationFromPrevious;
    if (durationDifference > 0) intervalDifficulty *= logistic(durationDifference / hitWindow, 0.35, 2, 1);
  }
  intervalDifficulty *= logistic(group.duration / hitWindow, 0.3, 2, 1);
  return Math.pow(intervalDifficulty, 0.75);
}

function longGapPenalty(previous: SameRhythmGroup | null): number {
  if (!previous) return 1;
  const gapInterval = previous.firstHitObject.deltaTime;
  const rhythmInterval = previous.hitObjectInterval ?? gapInterval;
  const gapRatio = gapInterval / Math.max(rhythmInterval, 1);
  const gapFactor = logistic(gapRatio, 1.75, 20);
  const lengthFactor = reverseLerp(previous.hitObjects.length, 8, 2);
  return 1 - 0.75 * gapFactor * lengthFactor;
}

function rhythmDifficulty(o: TaikoDifficultyHitObject): number {
  if (!o.isHit) return 0;
  const r = o.rhythm;
  let sameRhythm = 0;
  let samePattern = 0;
  let intervalPenalty = 0;
  let gapPenalty = 0;
  const hitWindow = o.hitWindowGreat;
  if (r.sameRhythm && r.sameRhythm.firstHitObject === o) {
    sameRhythm += 10 * sameRhythmDifficulty(r.sameRhythm, hitWindow);
    intervalPenalty = repeatedIntervalPenalty(r.sameRhythm, hitWindow);
    gapPenalty = longGapPenalty(r.sameRhythm.previous);
  }
  if (r.samePatterns && r.samePatterns.firstHitObject === o) samePattern += 1.15 * ratioDifficulty(r.samePatterns.intervalRatio);
  return Math.max(sameRhythm, samePattern) * intervalPenalty * gapPenalty;
}

function availableFingersFor(o: TaikoDifficultyHitObject): number {
  const previousColourChange = o.colour.monoStreak?.firstHitObject.previousNote(0) ?? null;
  const nextColourChange = o.colour.monoStreak?.lastHitObject.nextNote(0) ?? null;
  if (previousColourChange && o.startTime - previousColourChange.startTime < 300) return 2;
  if (nextColourChange && nextColourChange.startTime - o.startTime < 300) return 2;
  return 8;
}

const speedBonus = (interval: number) => 20 / Math.max(interval, 1);

function staminaDifficulty(o: TaikoDifficultyHitObject): number {
  if (!o.isHit) return 0;
  const previous = o.previous(1);
  const previousMono = o.previousMono(availableFingersFor(o) - 1);
  let objectStrain = 0.5;
  if (!previous) return objectStrain;
  if (previousMono) objectStrain += speedBonus(o.startTime - previousMono.startTime) + 0.5 * speedBonus(o.startTime - previous.startTime);
  return objectStrain;
}

// --- Skills ---

class Colour extends StrainDecaySkill<TaikoDifficultyHitObject> {
  protected skillMultiplier = 0.12;
  protected strainDecayBase = 0.8;
  protected strainValueOf(current: TaikoDifficultyHitObject) {
    return colourDifficulty(current);
  }
}

class Rhythm extends StrainDecaySkill<TaikoDifficultyHitObject> {
  protected skillMultiplier = 1;
  protected strainDecayBase = 0.4;
  protected strainValueOf(current: TaikoDifficultyHitObject) {
    const difficulty = rhythmDifficulty(current);
    const stamina = staminaDifficulty(current) - 0.5;
    return difficulty * logistic(stamina, 1 / 15, 50);
  }
}

const monoStreakIndex = (o: TaikoDifficultyHitObject) => (o.colour.monoStreak ? o.colour.monoStreak.hitObjects.indexOf(o) : 0);

class Reading extends StrainDecaySkill<TaikoDifficultyHitObject> {
  protected skillMultiplier = 1;
  protected strainDecayBase = 0.4;
  // A second strain on top of StrainDecaySkill's own one, as in lazer.
  private readingStrain = 0;
  protected strainValueOf(current: TaikoDifficultyHitObject) {
    if (!current.isHit) return 0;
    const index = monoStreakIndex(current);
    this.readingStrain *= logistic(index, 4, -1 / 25, 0.5) + 0.5;
    this.readingStrain *= this.strainDecayBase;
    this.readingStrain += readingDifficulty(current) * this.skillMultiplier;
    return this.readingStrain;
  }
}

class Stamina extends StrainSkill<TaikoDifficultyHitObject> {
  private currentStrain = 0;

  constructor(
    readonly singleColour: boolean,
    private readonly isConvert: boolean,
  ) {
    super();
  }

  private strainDecay(ms: number) {
    return Math.pow(0.4, ms / 1000);
  }

  protected strainValueAt(current: TaikoDifficultyHitObject): number {
    this.currentStrain *= this.strainDecay(current.deltaTime);
    let difficulty = staminaDifficulty(current) * 1.1;
    const index = monoStreakIndex(current);
    const monoLengthBonus = this.isConvert ? 1 : 1 + 0.5 * reverseLerp(index, 5, 20);
    if (!this.singleColour) difficulty *= monoLengthBonus;
    this.currentStrain += difficulty;
    return this.singleColour ? logisticExp(-(index - 10) / 2, this.currentStrain) : this.currentStrain;
  }

  protected calculateInitialStrain(time: number, current: TaikoDifficultyHitObject): number {
    return this.singleColour ? 0 : this.currentStrain * this.strainDecay(time - current.previous(0)!.startTime);
  }
}

// --- Calculator ---

const DIFFICULTY_MULTIPLIER = 0.084375;
const RHYTHM_SKILL_MULTIPLIER = 0.77 * DIFFICULTY_MULTIPLIER;
const READING_SKILL_MULTIPLIER = 0.1 * DIFFICULTY_MULTIPLIER;
const COLOUR_SKILL_MULTIPLIER = 0.375 * DIFFICULTY_MULTIPLIER;
const STAMINA_SKILL_MULTIPLIER = 0.445 * DIFFICULTY_MULTIPLIER;

function taikoObjects(bm: Beatmap): TaikoObject[] {
  const offset = timeOffset(bm);
  const out: TaikoObject[] = bm.hitObjects.map((o) => {
    const startTime = o.time + offset;
    if (o.kind === 'slider') return { kind: 'drumroll', type: null, startTime };
    if (o.kind === 'spinner' || o.kind === 'hold') return { kind: 'swell', type: null, startTime };
    return { kind: 'hit', type: o.hitSound & (2 | 8) ? 'rim' : 'centre', startTime };
  });
  return out.sort((a, b) => a.startTime - b.startTime);
}

export function taikoStarRating(bm: Beatmap, clockRate = 1): number {
  const objects = taikoObjects(bm);
  if (objects.length === 0) return 0;
  const diff = difficultySettings(bm);
  const cp = controlPoints(bm);
  const scroll = cp.difficulty.map((d) => ({ time: d.time, speed: clampNum(d.speed, 0.01, 10) }));
  const ctx = {
    greatWindow: Math.floor(difficultyRange(diff.overallDifficulty, 50, 35, 20)) - 0.5,
    bpmAt: (t: number) => 60000 / timingPointAt(cp, t).beatLength,
    scrollSpeedAt: (t: number) => lastAtOrBefore(scroll, t)?.speed ?? 1,
    sliderMultiplier: diff.sliderMultiplier,
  };
  const all: TaikoDifficultyHitObject[] = [];
  const centre: TaikoDifficultyHitObject[] = [];
  const rim: TaikoDifficultyHitObject[] = [];
  const notes: TaikoDifficultyHitObject[] = [];
  for (let i = 2; i < objects.length; i++) all.push(new TaikoDifficultyHitObject(objects[i], objects[i - 1], clockRate, all, centre, rim, notes, all.length, ctx));
  processColour(all);
  processRhythm(notes);

  const isConvert = false;
  const rhythm = new Rhythm();
  const reading = new Reading();
  const colour = new Colour();
  const stamina = new Stamina(false, isConvert);
  const singleColourStamina = new Stamina(true, isConvert);
  for (const o of all) for (const s of [rhythm, reading, colour, stamina, singleColourStamina]) s.process(o);

  const staminaDifficultyValue = stamina.difficultyValue();
  const colourSkill = colour.difficultyValue() * COLOUR_SKILL_MULTIPLIER;
  const staminaSkill = staminaDifficultyValue * STAMINA_SKILL_MULTIPLIER;
  const staminaDifficultStrains = stamina.countTopWeightedStrains(staminaDifficultyValue);
  const patternMultiplier = Math.pow(staminaSkill * colourSkill, 0.1);
  const strainLengthBonus = 1 + 0.15 * reverseLerp(staminaDifficultStrains, 1000, 1555);

  const rhythmPeaks = rhythm.currentStrainPeaks();
  const readingPeaks = reading.currentStrainPeaks();
  const colourPeaks = colour.currentStrainPeaks();
  const staminaPeaks = stamina.currentStrainPeaks();
  const peaks: number[] = [];
  for (let i = 0; i < colourPeaks.length; i++) {
    const rhythmPeak = rhythmPeaks[i] * RHYTHM_SKILL_MULTIPLIER * patternMultiplier;
    const readingPeak = readingPeaks[i] * READING_SKILL_MULTIPLIER;
    const colourPeak = colourPeaks[i] * COLOUR_SKILL_MULTIPLIER;
    let staminaPeak = staminaPeaks[i] * STAMINA_SKILL_MULTIPLIER * strainLengthBonus;
    staminaPeak /= isConvert ? 1.5 : 1;
    const peak = norm(2, norm(1.5, colourPeak, staminaPeak), rhythmPeak, readingPeak);
    if (peak > 0) peaks.push(peak);
  }
  let difficulty = 0;
  let weight = 1;
  for (const strain of sortedDescending(peaks)) {
    difficulty += strain * weight;
    weight *= 0.9;
  }
  const sr = difficulty * 1.4;
  return sr < 0 ? sr : 10.43 * Math.log(sr / 8 + 1);
}
