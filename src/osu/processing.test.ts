import { describe, expect, it } from 'vitest';
import { processBeatmap, stackTarget } from './processing';
import { createEmptyBeatmap, defaultSample, newObjectId, type Beatmap, type Circle, type HitObject, type Slider, type Vec2 } from './types';

/** A standard beatmap with one red line at 1000 ms, AR9 and StackLeniency 0.7 (stacking threshold 420 ms). */
function map(objects: HitObject[], opts: { ar?: number; stackLeniency?: number; cs?: number } = {}): Beatmap {
  const bm = createEmptyBeatmap();
  bm.general.stackLeniency = opts.stackLeniency ?? 0.7;
  bm.difficulty.approachRate = opts.ar ?? 9;
  bm.difficulty.circleSize = opts.cs ?? 4;
  bm.timingPoints = [
    { time: 1000, beatLength: 500, meter: 4, sampleSet: 0, sampleIndex: 0, volume: 60, uninherited: true, kiai: false, omitFirstBarLine: false },
  ];
  bm.hitObjects = objects;
  return bm;
}

function circle(x: number, y: number, time: number): Circle {
  return { id: newObjectId(), kind: 'circle', x, y, time, newCombo: false, comboSkip: 0, hitSound: 0, sample: defaultSample() };
}

function slider(x: number, y: number, time: number, to: Vec2, length: number): Slider {
  return {
    id: newObjectId(),
    kind: 'slider',
    x,
    y,
    time,
    newCombo: false,
    comboSkip: 0,
    hitSound: 0,
    sample: defaultSample(),
    curveType: 'L',
    points: [to],
    slides: 1,
    length,
    edgeSounds: [0, 0],
    edgeSets: [
      { normal: 0, addition: 0 },
      { normal: 0, addition: 0 },
    ],
  };
}

describe('stacking time references (stable: circle compares starts, slider compares ends)', () => {
  it('does not stack a circle 129 ms after a long slider ends', () => {
    // Slider 1000 → 2071 (300 px at 1.4x slider multiplier and 500 ms beats), circle at 2200 one pixel away
    // from the slider head. Stable compares the circle's start (2200) with the slider's start (1000): 1200 ms
    // is past the 420 ms threshold, so neither object stacks.
    const s = slider(100, 100, 1000, { x: 400, y: 100 }, 300);
    const c = circle(101, 100, 2200);
    const proc = processBeatmap(map([s, c]));
    expect(proc.info.get(s.id)!.endTime).toBeCloseTo(2071.43, 1);
    expect(proc.info.get(c.id)!.stackHeight).toBe(0);
    expect(proc.info.get(s.id)!.stackHeight).toBe(0);
  });

  it('stacks a slider onto a long slider that ends within the threshold', () => {
    // Slider A runs 1000 → 1714. Slider B starts at 1800 on A's tail: 85 ms after A ends, well inside the
    // 420 ms threshold. A slider compares the previous object's end, so the two stack (A is lifted).
    const a = slider(100, 100, 1000, { x: 300, y: 100 }, 200);
    const b = slider(300, 100, 1800, { x: 500, y: 100 }, 200);
    const proc = processBeatmap(map([a, b]));
    expect(proc.info.get(a.id)!.endTime).toBeCloseTo(1714.29, 1);
    expect(proc.info.get(b.id)!.stackHeight).toBe(0);
    expect(proc.info.get(a.id)!.stackHeight).toBe(1);
  });

  it('stacks two circles two pixels apart (the earlier one gets the height)', () => {
    const a = circle(100, 100, 1000);
    const b = circle(102, 100, 1100);
    const proc = processBeatmap(map([a, b]));
    expect(proc.info.get(a.id)!.stackHeight).toBe(1);
    expect(proc.info.get(b.id)!.stackHeight).toBe(0);
  });

  it('leaves circles more than 3 osu!px apart alone', () => {
    const a = circle(100, 100, 1000);
    const b = circle(104, 100, 1100);
    const proc = processBeatmap(map([a, b]));
    expect(proc.info.get(a.id)!.stackHeight).toBe(0);
    expect(proc.info.get(b.id)!.stackHeight).toBe(0);
  });
});

describe('stackTarget (placement snapping onto a shown head or slider tail)', () => {
  const a = circle(100, 100, 1000);

  it('leaves a point 5 px away alone', () => {
    const proc = processBeatmap(map([a]));
    expect(stackTarget({ x: 105, y: 100 }, [a], proc, 3)).toBeNull();
  });

  it('leaves a point where the old radius-based tolerance used to snap (16 px at CS5)', () => {
    const b = circle(300, 300, 2000);
    const proc = processBeatmap(map([b], { cs: 5 }));
    expect(stackTarget({ x: 316, y: 300 }, [b], proc, 3)).toBeNull();
  });

  it('snaps a point 2 px away exactly onto the circle', () => {
    const proc = processBeatmap(map([a]));
    expect(stackTarget({ x: 102, y: 100 }, [a], proc, 3)).toEqual({ x: 100, y: 100 });
  });

  it('snaps onto a slider tail, but not onto its body', () => {
    const s = slider(100, 100, 1000, { x: 400, y: 100 }, 300);
    const proc = processBeatmap(map([s]));
    expect(stackTarget({ x: 398, y: 101 }, [s], proc, 3)).toEqual({ x: 400, y: 100 });
    expect(stackTarget({ x: 250, y: 100 }, [s], proc, 3)).toBeNull();
  });

  it('uses the stacked (visible) position of a stacked object', () => {
    const early = circle(100, 100, 1000);
    const late = circle(102, 100, 1100);
    const proc = processBeatmap(map([early, late]));
    const visible = { x: 100 + proc.stackOffset, y: 100 + proc.stackOffset };
    expect(stackTarget(visible, [early], proc, 3)).toEqual({ x: 100, y: 100 });
  });
});
