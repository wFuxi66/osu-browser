import { describe, expect, it } from 'vitest';
import { sliderFromShape, nextPlacementTime, snapSliderLength } from './placement';
import { getSliderPath } from '../osu/curves';
import { objectEndTime, snapTime } from '../osu/timing';
import { createEmptyBeatmap, defaultSample, newObjectId, type Beatmap, type Circle, type Spinner } from '../osu/types';

/** A standard beatmap with a 500 ms red line at 1000 and a 1/4 divisor. */
function map(): Beatmap {
  const bm = createEmptyBeatmap();
  bm.editor.beatDivisor = 4;
  bm.timingPoints = [
    { time: 1000, beatLength: 500, meter: 4, sampleSet: 0, sampleIndex: 0, volume: 60, uninherited: true, kiai: false, omitFirstBarLine: false },
  ];
  return bm;
}

/** A placement shape starting at (100, 100): the head, then `points`. */
const shape = (points: { x: number; y: number }[], slides = 1) => ({
  id: newObjectId(),
  time: 1000,
  vertices: [{ x: 100, y: 100 }, ...points],
  slides,
  newCombo: false,
  hitSound: 0,
  sample: defaultSample(),
});

const circle = (time: number): Circle => ({ id: newObjectId(), kind: 'circle', x: 100, y: 100, time, newCombo: false, comboSkip: 0, hitSound: 0, sample: defaultSample() });

describe('nextPlacementTime (stable auto-advance)', () => {
  it('moves a circle to the next beat-divisor tick', () => {
    const bm = map();
    const o = circle(1000);
    expect(nextPlacementTime(bm, o, bm.editor.beatDivisor)).toBe(1125);
    // Not where the object is: placing again can never replace it.
    expect(nextPlacementTime(bm, o, bm.editor.beatDivisor)! - o.time).toBeGreaterThanOrEqual(1);
  });

  it('steps several ticks on touch', () => {
    const bm = map();
    expect(nextPlacementTime(bm, circle(1000), 4, 2)).toBe(1250);
  });

  it('moves a slider to its end, repeats included', () => {
    const bm = map();
    const one = sliderFromShape(shape([{ x: 240, y: 100 }]))!;
    // 140 osu!px of path = one beat = 500 ms at 1.4x slider multiplier.
    expect(nextPlacementTime(bm, one, 4)).toBeCloseTo(1500, 6);
    const twice = sliderFromShape(shape([{ x: 240, y: 100 }], 2))!;
    expect(nextPlacementTime(bm, twice, 4)).toBeCloseTo(2000, 6);
  });

  it('moves a spinner to its end', () => {
    const bm = map();
    const o: Spinner = { id: newObjectId(), kind: 'spinner', x: 256, y: 192, time: 1000, endTime: 2500, newCombo: true, comboSkip: 0, hitSound: 0, sample: defaultSample() };
    expect(nextPlacementTime(bm, o, 4)).toBe(2500);
  });

  it('leaves the playhead alone for a mania hold', () => {
    const bm = map();
    expect(nextPlacementTime(bm, { id: 1, kind: 'hold', x: 64, y: 192, time: 1000, endTime: 2000, newCombo: false, comboSkip: 0, hitSound: 0, sample: defaultSample() }, 4)).toBeNull();
  });
});

describe('sliderFromShape (what a placement builds)', () => {
  it('keeps the drawn path length, not a whole number of divisor ticks', () => {
    const bm = map();
    // A straight line 104.4 px long: the 1/4 divisor tick is 35 px, so snapping would cut it to 70.
    const s = sliderFromShape(shape([{ x: 200, y: 130 }]))!;
    expect(s.length).toBeCloseTo(104.403, 2);
    const end = objectEndTime(bm, s);
    expect(end).toBeCloseTo(1000 + (s.length / 140) * 500, 6);
    // The end really is between two divisor ticks.
    expect(snapTime(bm, end, bm.editor.beatDivisor)).not.toBeCloseTo(end, 3);
  });

  it('gives a slider one edge set per span plus the tail, so repeats carry sounds', () => {
    const s = sliderFromShape({ ...shape([{ x: 200, y: 100 }], 3), hitSound: 2 })!;
    expect(s.slides).toBe(3);
    expect(s.edgeSounds).toEqual([2, 2, 2, 2]);
    expect(s.edgeSets).toHaveLength(4);
  });

  it('refuses a path shorter than a pixel', () => {
    expect(sliderFromShape(shape([{ x: 100, y: 100 }]))).toBeNull();
    expect(sliderFromShape(shape([]))).toBeNull();
  });

  it('auto-picks the curve type of the drawn points', () => {
    expect(sliderFromShape(shape([{ x: 200, y: 100 }]))!.curveType).toBe('L');
    const arc = sliderFromShape(shape([{ x: 200, y: 100 }, { x: 200, y: 200 }]))!;
    expect(arc.curveType).toBe('P');
    expect(getSliderPath(arc).length).toBeGreaterThan(1);
  });

  it('the explicit recalculate command still snaps a slider to whole divisor ticks', () => {
    const bm = map();
    const s = sliderFromShape(shape([{ x: 200, y: 130 }]))!;
    expect(s.length).toBeCloseTo(104.403, 2);
    // 1/4 of a 140 px beat is 35 px: the recalculate command floors the 104.4 px path to 2 whole ticks (70 px).
    snapSliderLength(bm, s, bm.editor.beatDivisor);
    expect(s.length).toBeCloseTo(70, 6);
    expect(snapTime(bm, objectEndTime(bm, s), bm.editor.beatDivisor)).toBeCloseTo(objectEndTime(bm, s), 3);
  });
});
