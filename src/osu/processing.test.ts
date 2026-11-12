import { describe, expect, it } from 'vitest';
import { parseOsu } from './parser';
import { processBeatmap, sliderTickProgresses, stackTarget } from './processing';
import { serializeBeatmap } from './serializer';
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

describe('stacking time references (stable: circle compares the previous end, slider the previous start)', () => {
  it('stacks a circle on a long slider tail it follows within the threshold', () => {
    // Slider 1000 → 2071 (300 px at 1.4x slider multiplier and 500 ms beats), circle at 2200 on its tail:
    // 129 ms after the slider ends, inside the 420 ms threshold, so the circle stacks below the tail.
    const s = slider(100, 100, 1000, { x: 400, y: 100 }, 300);
    const c = circle(400, 100, 2200);
    const proc = processBeatmap(map([s, c]));
    expect(proc.info.get(s.id)!.endTime).toBeCloseTo(2071.43, 1);
    expect(proc.info.get(c.id)!.stackHeight).toBe(-1);
    expect(proc.info.get(s.id)!.stackHeight).toBe(0);
  });

  it('does not stack a slider on a long slider tail when the heads are past the threshold', () => {
    // Slider A runs 1000 → 1714. Slider B starts at 1800 on A's tail: 86 ms after A ends, but 800 ms after
    // A starts, and a slider compares the previous start, so with a 420 ms threshold nothing stacks.
    const a = slider(100, 100, 1000, { x: 300, y: 100 }, 200);
    const b = slider(300, 100, 1800, { x: 500, y: 100 }, 200);
    const proc = processBeatmap(map([a, b]));
    expect(proc.info.get(a.id)!.endTime).toBeCloseTo(1714.29, 1);
    expect(proc.info.get(a.id)!.stackHeight).toBe(0);
    expect(processBeatmap(map([a, { ...b, time: 1400 }])).info.get(a.id)!.stackHeight).toBe(1);
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

  it('reports the longest object, so a view can look back far enough for one still running', () => {
    const s = slider(100, 100, 1000, { x: 300, y: 100 }, 200);
    const c = circle(100, 200, 5000);
    const proc = processBeatmap(map([s, c]));
    // 200 px at 1.4x slider multiplier and 500 ms beats is 714 ms: longer than the 1200 ms preempt is not needed
    // here, but a slider can easily outlast it and must not be culled while it is still being played.
    expect(proc.maxDuration).toBeCloseTo(714.29, 1);
    expect(proc.maxDuration).toBeGreaterThan(proc.info.get(c.id)!.endTime - c.time);
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

describe('older file formats', () => {
  /** A long slider (5 s at 100 px per 500 ms beat), then a short slider on its head; a green line doubles the speed from 10000 ms. */
  const old = (version: number) =>
    parseOsu(`osu file format v${version}

[Difficulty]
ApproachRate:9
SliderMultiplier:1
SliderTickRate:1

[TimingPoints]
0,500,4,2,0,100,1,0
10000,-50,4,2,0,100,0,0

[HitObjects]
100,100,1000,2,0,L|400:100,1,1000
100,100,6300,2,0,L|100:200,1,50
100,300,10000,2,0,L|400:300,1,300
`);

  it('format v5 and older stack as stable does for them', () => {
    const height = (version: number) => {
      const bm = old(version);
      return processBeatmap(bm).info.get(bm.hitObjects[0].id)!.stackHeight;
    };
    expect(height(5)).toBe(1);
    expect(height(14)).toBe(0);
  });

  it('before format v8, slider ticks ignore green lines', () => {
    const ticks = (version: number) => {
      const bm = old(version);
      return sliderTickProgresses(bm, bm.hitObjects[2] as Slider).length;
    };
    expect(ticks(7)).toBe(2);
    expect(ticks(8)).toBe(1);
  });

  it('saving keeps the format version and fractional timing points', () => {
    const bm = parseOsu('osu file format v4\n\n[TimingPoints]\n1.36563876651985,500,4,2,0,100,1,0\n');
    const again = parseOsu(serializeBeatmap(bm));
    expect(again.formatVersion).toBe(4);
    expect(again.timingPoints[0].time).toBeCloseTo(1.36563876651985, 10);
  });
});
