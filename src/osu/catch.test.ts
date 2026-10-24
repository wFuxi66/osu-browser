import { describe, expect, it } from 'vitest';
import { catchObjects, juiceStreamPath, markHyperdashes, sliderVelocity } from './catch';
import { getSliderPath } from './curves';
import { createEmptyBeatmap, defaultSample, newObjectId, type HitObject } from './types';

function beatmap(objects: Partial<HitObject>[]) {
  const bm = createEmptyBeatmap();
  bm.general.mode = 2;
  bm.difficulty.sliderMultiplier = 1;
  bm.timingPoints.push({ time: 0, beatLength: 500, meter: 4, sampleSet: 2, sampleIndex: 0, volume: 70, uninherited: true, kiai: false, omitFirstBarLine: false });
  for (const o of objects) bm.hitObjects.push({ kind: 'circle', id: newObjectId(), x: 256, y: 192, time: 0, newCombo: false, comboSkip: 0, hitSound: 0, sample: defaultSample(), ...o } as HitObject);
  return bm;
}

describe('osu!catch', () => {
  it('builds juice streams whose length matches the time between vertices', () => {
    const vel = 0.2; // px per ms
    const { head, points, length } = juiceStreamPath([{ time: 0, x: 100 }, { time: 500, x: 150 }, { time: 1000, x: 400 }], vel);
    expect(head).toEqual({ x: 100, y: 384 });
    expect(length).toBeCloseTo(200);
    // The horizontal move is limited by the distance travelled (100px per segment here).
    expect(points[0].x).toBe(150);
    expect(points[1].x).toBe(250);
  });

  it('generates fruits, droplets and tiny droplets for a juice stream', () => {
    const bm = beatmap([]);
    const vel = sliderVelocity(bm, 0);
    const { head, points, length } = juiceStreamPath([{ time: 0, x: 100 }, { time: 1000, x: 300 }], vel);
    bm.hitObjects.push({ kind: 'slider', id: newObjectId(), x: head.x, y: head.y, time: 0, newCombo: true, comboSkip: 0, hitSound: 0, sample: defaultSample(), curveType: 'L', points, slides: 2, length, edgeSounds: [0, 0, 0], edgeSets: [{ normal: 0, addition: 0 }, { normal: 0, addition: 0 }, { normal: 0, addition: 0 }] });
    expect(getSliderPath(bm.hitObjects[0] as never).length).toBeCloseTo(length, 0);
    const objs = catchObjects(bm);
    const fruits = objs.filter((o) => o.kind === 'fruit');
    expect(fruits.map((f) => Math.round(f.time))).toEqual([0, 1000, 2000]);
    expect(fruits.map((f) => Math.round(f.x))).toEqual([100, 300, 100]);
    expect(objs.filter((o) => o.kind === 'droplet').length).toBe(2);
    expect(objs.some((o) => o.kind === 'tiny')).toBe(true);
  });

  it('flags hyperdashes for jumps the catcher cannot walk', () => {
    const bm = beatmap([{ time: 0, x: 0 }, { time: 100, x: 512 }, { time: 1000, x: 500 }]);
    const objs = catchObjects(bm);
    markHyperdashes(objs, bm.difficulty.circleSize);
    expect(objs.map((o) => o.hyper)).toEqual([true, false, undefined]);
  });
});
