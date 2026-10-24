import { describe, expect, it } from 'vitest';
import { parseOsu } from './parser';
import { starRating } from './stars';
import type { GameMode } from './types';

// Real maps are checked against osu.ppy.sh in stars.website.test.ts; these pin the behaviour on generated maps.

function osuFile(mode: GameMode, objects: string[], difficulty: Record<string, number> = {}, version = 14): string {
  const d = { HPDrainRate: 5, CircleSize: 4, OverallDifficulty: 8, ApproachRate: 9, SliderMultiplier: 1.8, SliderTickRate: 1, ...difficulty };
  return [
    `osu file format v${version}`,
    '[General]',
    'AudioFilename: audio.mp3',
    `Mode: ${mode}`,
    '[Difficulty]',
    ...Object.entries(d).map(([k, v]) => `${k}:${v}`),
    '[TimingPoints]',
    '1000,333.333333333333,4,2,0,60,1,0',
    '20000,-50,4,2,0,60,0,0',
    '[HitObjects]',
    ...objects,
  ].join('\n');
}

/** Square jumps at 1/2, a burst, then sliders (with a repeat) at 2x SV. */
function osuObjects(): string[] {
  const out: string[] = [];
  const corners = [
    [64, 64],
    [448, 64],
    [448, 320],
    [64, 320],
  ];
  let t = 1000;
  for (let i = 0; i < 32; i++, t += 166) out.push(`${corners[i % 4][0]},${corners[i % 4][1]},${Math.round(t)},${i % 4 === 0 ? 5 : 1},0,0:0:0:0:`);
  for (let i = 0; i < 16; i++, t += 83) out.push(`${200 + (i % 2) * 40},${180 + i * 6},${Math.round(t)},1,0,0:0:0:0:`);
  t = 20000;
  for (let i = 0; i < 8; i++, t += 666) out.push(`${100 + (i % 2) * 300},200,${Math.round(t)},2,0,B|${180 + (i % 2) * 140}:100|${260 + (i % 2) * 60}:200,${1 + (i % 3 === 0 ? 1 : 0)},180`);
  return out;
}

const rating = (mode: GameMode, objects: string[], difficulty?: Record<string, number>, version?: number) =>
  starRating(parseOsu(osuFile(mode, objects, difficulty, version)));

describe('starRating', () => {
  it('is 0 for maps with fewer than two objects', () => {
    expect(rating(0, [])).toBe(0);
    expect(rating(0, ['256,192,1000,1,0,0:0:0:0:'])).toBe(0);
  });

  it('rates a generated osu! map', () => {
    expect(rating(0, osuObjects())).toBeCloseTo(6.3021, 4);
  });

  it('rates small circles higher', () => {
    expect(rating(0, osuObjects(), { CircleSize: 6 })!).toBeGreaterThan(rating(0, osuObjects())!);
  });

  it('rates generated taiko, catch and mania maps', () => {
    const taiko = Array.from({ length: 96 }, (_, i) => `256,192,${1000 + i * 83},1,${i % 3 === 0 ? 2 : 0},0:0:0:0:`);
    const fruits = Array.from({ length: 64 }, (_, i) => `${i % 2 ? 64 : 448},192,${1000 + i * 166},1,0,0:0:0:0:`);
    const mania = Array.from({ length: 128 }, (_, i) => `${64 + (i % 4) * 128},192,${1000 + i * 83},${i % 8 === 0 ? 128 : 1},0,${i % 8 === 0 ? `${1300 + i * 83}:` : ''}0:0:0:0:`);
    const values = [rating(1, taiko), rating(2, fruits), rating(3, mania, { CircleSize: 4 })];
    expect(values.map((v) => Number(v!.toFixed(4)))).toEqual([4.3966, 4.9538, 2.7319]);
  });

  it('uses OD as AR in files without an ApproachRate line', () => {
    const withAr = parseOsu(osuFile(0, osuObjects(), { OverallDifficulty: 7, ApproachRate: 7 }, 6));
    const text = osuFile(0, osuObjects(), { OverallDifficulty: 7 }, 6).replace(/^ApproachRate:.*\n/m, '');
    const without = parseOsu(text);
    expect(without.difficulty.approachRate).toBe(7);
    expect(starRating(without)).toBe(starRating(withAr));
  });
});
