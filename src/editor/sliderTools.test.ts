import { describe, expect, it } from 'vitest';
import { getSliderPath, SliderPath } from '../osu/curves';
import { objectEndTime, svAt } from '../osu/timing';
import { createEmptyBeatmap, defaultSample, type Beatmap, type Circle, type CurveType, type Slider, type TimingPoint, type Vec2 } from '../osu/types';
import { applyCompletion, applyMerge, bezierSegments, planCompletion, planMerge, type CompletionOptions, type MergeOptions } from './sliderTools';

let nextId = 1;

function slider(time: number, type: CurveType, verts: Vec2[], length: number, extra: Partial<Slider> = {}): Slider {
  return {
    id: nextId++,
    kind: 'slider',
    x: verts[0].x,
    y: verts[0].y,
    time,
    newCombo: false,
    comboSkip: 0,
    hitSound: 0,
    sample: defaultSample(),
    curveType: type,
    points: verts.slice(1),
    slides: 1,
    length,
    edgeSounds: [0, 0],
    edgeSets: [{ normal: 0, addition: 0 }, { normal: 0, addition: 0 }],
    ...extra,
  };
}

function circle(time: number, x: number, y: number, hitSound = 0): Circle {
  return { id: nextId++, kind: 'circle', x, y, time, newCombo: false, comboSkip: 0, hitSound, sample: defaultSample() };
}

function tp(time: number, beatLength: number, uninherited: boolean, extra: Partial<TimingPoint> = {}): TimingPoint {
  return { time, beatLength, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 70, uninherited, kiai: false, omitFirstBarLine: false, ...extra };
}

/** 120 BPM, slider multiplier 1.4: 140 px per beat at 1× SV. */
function map(...objs: Beatmap['hitObjects']): Beatmap {
  const bm = createEmptyBeatmap();
  bm.difficulty.sliderMultiplier = 1.4;
  bm.timingPoints = [tp(0, 500, true)];
  bm.hitObjects = objs;
  return bm;
}

const defaults: CompletionOptions = { free: 'velocity', beats: null, endTime: null, completion: 1, sv: null, moveAnchors: false };

function complete(bm: Beatmap, sliders: Slider[], o: Partial<CompletionOptions> = {}) {
  const opts = { ...defaults, ...o };
  const plans = planCompletion(bm, sliders, opts);
  applyCompletion(bm, plans, opts);
  return plans;
}

describe('Slider Completionator', () => {
  it('stretches a slider to its last anchor by changing SV, keeping its end time and the next slider SV', () => {
    const a = slider(1000, 'L', [{ x: 0, y: 0 }, { x: 280, y: 0 }], 140);
    const b = slider(3000, 'L', [{ x: 0, y: 100 }, { x: 140, y: 100 }], 140);
    const bm = map(a, b);
    const end = objectEndTime(bm, a);
    complete(bm, [a]);
    expect(a.length).toBeCloseTo(280, 6);
    expect(svAt(bm, a.time)).toBeCloseTo(2, 9);
    expect(objectEndTime(bm, a)).toBeCloseTo(end, 6);
    expect(svAt(bm, b.time)).toBe(1);
    expect(bm.timingPoints.filter((t) => !t.uninherited).map((t) => [t.time, t.beatLength])).toEqual([[1000, -50], [3000, -100]]);
  });

  it('copies the volume, sample set and kiai of the timing section into new green lines', () => {
    const a = slider(1000, 'L', [{ x: 0, y: 0 }, { x: 280, y: 0 }], 140);
    const bm = map(a);
    bm.timingPoints.push(tp(500, -100, false, { volume: 40, sampleSet: 3, sampleIndex: 2, kiai: true }));
    complete(bm, [a]);
    const green = bm.timingPoints.find((t) => t.time === 1000)!;
    expect(green).toMatchObject({ uninherited: false, volume: 40, sampleSet: 3, sampleIndex: 2, kiai: true });
  });

  it('updates a green line already on the slider instead of adding one', () => {
    const a = slider(1000, 'L', [{ x: 0, y: 0 }, { x: 280, y: 0 }], 140);
    const bm = map(a);
    bm.timingPoints.push(tp(1000, -100, false));
    complete(bm, [a]);
    expect(bm.timingPoints).toHaveLength(2);
    expect(bm.timingPoints[1].beatLength).toBeCloseTo(-50, 9);
  });

  it('ends a slider at a given time, counting its repeats', () => {
    const a = slider(1000, 'L', [{ x: 0, y: 0 }, { x: 140, y: 0 }], 140, { slides: 2, edgeSounds: [0, 0, 0], edgeSets: Array(3).fill({ normal: 0, addition: 0 }) });
    const bm = map(a);
    complete(bm, [a], { endTime: 1500, completion: null });
    expect(objectEndTime(bm, a)).toBeCloseTo(1500, 6);
    expect(svAt(bm, a.time)).toBeCloseTo(2, 9);
  });

  it('works out the length from a duration in beats and an SV', () => {
    const a = slider(1000, 'L', [{ x: 0, y: 0 }, { x: 400, y: 0 }], 100);
    const bm = map(a);
    complete(bm, [a], { free: 'length', beats: 2, sv: 1, completion: null });
    expect(a.length).toBeCloseTo(280, 6);
    expect(bm.timingPoints).toHaveLength(1);
  });

  it('refuses an SV osu! cannot have and leaves that slider alone', () => {
    const a = slider(1000, 'L', [{ x: 0, y: 0 }, { x: 400, y: 0 }], 10);
    const bm = map(a);
    const plans = complete(bm, [a]);
    expect(plans[0].error).toMatch(/SV/);
    expect(a.length).toBe(10);
    expect(bm.timingPoints).toHaveLength(1);
  });

  it('moves the anchors to cut a curved path at the new length', () => {
    const a = slider(1000, 'B', [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }], 50);
    const bm = map(a);
    const full = new SliderPath('B', [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }]).rawLength;
    const end = objectEndTime(bm, a);
    const half = getSliderPath({ ...a, length: full / 2 }).positionAt(1);
    complete(bm, [a], { completion: 0.5, moveAnchors: true });
    const raw = new SliderPath(a.curveType, [{ x: a.x, y: a.y }, ...a.points]).rawLength;
    expect(Math.abs(raw - full / 2)).toBeLessThan(1.5);
    expect(a.length).toBeLessThanOrEqual(raw);
    const tail = a.points[a.points.length - 1];
    expect(Math.hypot(tail.x - half.x, tail.y - half.y)).toBeLessThan(1);
    expect(objectEndTime(bm, a)).toBeCloseTo(end, 6);
  });
});

const mergeDefaults: MergeOptions = { leniency: 256, connection: 'move', linearOnLinear: false };

function merge(bm: Beatmap, o: Partial<MergeOptions> = {}) {
  const plan = planMerge(bm.hitObjects, { ...mergeDefaults, ...o });
  applyMerge(bm, plan);
  return plan;
}

describe('Slider Merger', () => {
  it('joins two touching linear sliders, with the first head sound and the last tail sound', () => {
    const a = slider(0, 'L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100, { edgeSounds: [2, 4], newCombo: true });
    const b = slider(1000, 'L', [{ x: 100, y: 0 }, { x: 100, y: 100 }], 100, { edgeSounds: [8, 4] });
    const bm = map(a, b);
    merge(bm, { linearOnLinear: true });
    expect(bm.hitObjects).toHaveLength(1);
    const s = bm.hitObjects[0] as Slider;
    expect(s).toMatchObject({ id: a.id, time: 0, newCombo: true, curveType: 'L', slides: 1, edgeSounds: [2, 4] });
    expect(s.points).toEqual([{ x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(s.length).toBeCloseTo(200, 2);
  });

  it('uses a red anchor between straight pieces unless they should stay linear', () => {
    const bm = map(slider(0, 'L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100), slider(1000, 'L', [{ x: 100, y: 0 }, { x: 100, y: 100 }], 100));
    merge(bm);
    const s = bm.hitObjects[0] as Slider;
    expect(s.curveType).toBe('B');
    expect(s.points).toEqual([{ x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it('moves the next slider onto the end of the previous one, or bridges the gap with a line', () => {
    const make = () => map(slider(0, 'L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100), slider(1000, 'L', [{ x: 110, y: 0 }, { x: 110, y: 100 }], 100));
    const moved = make();
    merge(moved, { connection: 'move', linearOnLinear: true });
    expect((moved.hitObjects[0] as Slider).points.at(-1)).toEqual({ x: 100, y: 100 });
    expect((moved.hitObjects[0] as Slider).length).toBeCloseTo(200, 2);
    const bridged = make();
    merge(bridged, { connection: 'linear', linearOnLinear: true });
    expect((bridged.hitObjects[0] as Slider).points.at(-1)).toEqual({ x: 110, y: 100 });
    expect((bridged.hitObjects[0] as Slider).length).toBeCloseTo(210, 2);
  });

  it('leaves objects further apart than the leniency', () => {
    const bm = map(slider(0, 'L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 100), circle(1000, 300, 0));
    expect(merge(bm, { leniency: 100 }).merged).toHaveLength(0);
    expect(bm.hitObjects).toHaveLength(2);
  });

  it('merges from where a slider really ends, not its last anchor', () => {
    const bm = map(slider(0, 'L', [{ x: 0, y: 0 }, { x: 300, y: 0 }], 100), circle(1000, 100, 50, 8));
    merge(bm, { leniency: 60, linearOnLinear: true });
    const s = bm.hitObjects[0] as Slider;
    expect(s.points).toEqual([{ x: 100, y: 0 }, { x: 100, y: 50 }]);
    expect(s.edgeSounds).toEqual([0, 8]);
    expect(s.length).toBeCloseTo(150, 2);
  });

  it('turns two circles into a linear slider, but not two on the same spot', () => {
    const bm = map(circle(0, 0, 0, 2), circle(500, 50, 0, 4));
    merge(bm);
    expect(bm.hitObjects[0]).toMatchObject({ kind: 'slider', curveType: 'L', points: [{ x: 50, y: 0 }], edgeSounds: [2, 4] });
    const stacked = map(circle(0, 0, 0), circle(500, 0, 0));
    expect(merge(stacked).merged).toHaveLength(0);
    expect(stacked.hitObjects.map((o) => o.kind)).toEqual(['circle', 'circle']);
  });

  it('chains several objects into one slider', () => {
    const bm = map(circle(0, 0, 0), slider(500, 'L', [{ x: 50, y: 0 }, { x: 100, y: 0 }], 50), circle(1000, 100, 50));
    const plan = merge(bm, { linearOnLinear: true });
    expect(plan.merged).toHaveLength(1);
    expect(bm.hitObjects).toHaveLength(1);
    expect((bm.hitObjects[0] as Slider).length).toBeCloseTo(150, 2);
  });

  it('keeps the shape of a perfect circle slider it merges', () => {
    const arc: Vec2[] = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }];
    const a = slider(0, 'P', arc, new SliderPath('P', arc).rawLength);
    const b = slider(1000, 'L', [{ x: 200, y: 0 }, { x: 300, y: 0 }], 100);
    const original = getSliderPath(a);
    const bm = map(a, b);
    merge(bm);
    const s = bm.hitObjects[0] as Slider;
    expect(s.curveType).toBe('B');
    expect(Math.abs(s.length - (original.length + 100))).toBeLessThan(1.5);
    const path = getSliderPath(s);
    for (const f of [0.25, 0.5, 0.75]) {
      const want = original.positionAt(f);
      const got = path.positionAt((f * original.length) / s.length);
      expect(Math.hypot(want.x - got.x, want.y - got.y)).toBeLessThan(1.5);
    }
  });
});

describe('bezierSegments', () => {
  it("matches osu!'s Catmull curve", () => {
    const verts: Vec2[] = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: -30 }, { x: 260, y: 80 }];
    const catmull = new SliderPath('C', verts);
    const segs = bezierSegments('C', verts);
    const bezierVerts = [...segs[0], ...segs.slice(1).flat()];
    const bezier = new SliderPath('B', bezierVerts);
    expect(Math.abs(bezier.rawLength - catmull.rawLength)).toBeLessThan(1);
    for (const f of [0.1, 0.4, 0.7, 1]) {
      const a = catmull.positionAt(f);
      const b = bezier.positionAt(f);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1);
    }
  });
});
