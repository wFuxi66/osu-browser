import { describe, expect, it } from 'vitest';
import { parseOsu } from '../osu/parser';
import { cycleTile, effectiveStats, moddedBeatmap, rateOf, scoreMultiplier, withMod } from './mods';
import { accuracyOf, gradeOf } from './scores';
import { StdGame } from './stdGame';

const MAP = `osu file format v14

[General]
AudioFilename: audio.mp3
Mode: 0
StackLeniency: 0.7

[Metadata]
Title:T
Artist:A
Creator:C
Version:V

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
1000,500,4,2,0,60,1,0

[HitObjects]
100,100,2000,1,0,0:0:0:0:
200,100,2500,1,0,0:0:0:0:
300,200,3000,2,0,L|400:200,2,140
256,192,5000,12,0,7000,0:0:0:0:
120,300,7500,5,0,0:0:0:0:
`;

function run(game: StdGame, until = 9000) {
  for (let t = 0; t <= until; t += 8) game.update(t);
}

describe('mods', () => {
  it('drops incompatible mods and cycles shared tiles', () => {
    expect(withMod(['EZ', 'HD'], 'HR')).toEqual(['HR', 'HD']);
    expect(withMod(['DT'], 'HT')).toEqual(['HT']);
    expect(withMod(['NF'], 'SD')).toEqual(['SD']);
    expect(cycleTile([], 'increase', 2)).toEqual(['DT']);
    expect(cycleTile(['DT'], 'increase', 2)).toEqual(['NC']);
    expect(cycleTile(['NC'], 'increase', 2)).toEqual([]);
    expect(cycleTile([], 'increase', 1, true)).toEqual(['PF']);
  });

  it('multiplies like stable', () => {
    expect(scoreMultiplier(['HD', 'HR'])).toBeCloseTo(1.1236);
    expect(scoreMultiplier(['EZ', 'NF'])).toBeCloseTo(0.25);
    expect(scoreMultiplier(['HR', 'V2'])).toBeCloseTo(1.1);
    expect(rateOf(['NC'])).toBe(1.5);
  });

  it('shows AR and OD at the song speed', () => {
    const s = effectiveStats({ cs: 4, ar: 9, od: 8, hp: 5 }, ['DT']);
    expect(s.ar).toBeCloseTo(10.33, 2);
    expect(s.od).toBeCloseTo(9.78, 2);
    expect(effectiveStats({ cs: 4, ar: 9, od: 8, hp: 5 }, ['HR']).cs).toBeCloseTo(5.2);
  });

  it('flips the map vertically with Hard Rock', () => {
    const bm = moddedBeatmap(parseOsu(MAP), ['HR']);
    expect(bm.hitObjects[0].y).toBe(284);
    expect(bm.difficulty.approachRate).toBe(10);
  });
});

describe('grades', () => {
  const c = (n300: number, n100: number, n50: number, nMiss: number) => ({ n300, n100, n50, nMiss, nGeki: 0, nKatu: 0 });
  it('follows stable', () => {
    expect(gradeOf(c(10, 0, 0, 0), [])).toBe('X');
    expect(gradeOf(c(10, 0, 0, 0), ['HD'])).toBe('XH');
    expect(gradeOf(c(95, 5, 0, 0), [])).toBe('S');
    expect(gradeOf(c(95, 4, 0, 1), [])).toBe('A');
    expect(gradeOf(c(85, 15, 0, 0), [])).toBe('A');
    expect(gradeOf(c(50, 50, 0, 0), [])).toBe('D');
    expect(accuracyOf(c(1, 1, 0, 0))).toBeCloseTo(2 / 3);
  });
});

describe('gameplay', () => {
  it('autoplay gets everything', () => {
    const game = new StdGame(parseOsu(MAP), ['AU'], { startTime: 0, test: false });
    run(game);
    expect(game.finished).toBe(true);
    expect(game.counts).toMatchObject({ n300: 5, n100: 0, n50: 0, nMiss: 0 });
    expect(game.maxCombo).toBe(game.mapMaxCombo);
    expect(game.accuracy).toBe(1);
    expect(game.score).toBeGreaterThan(0);
  });

  it('misses everything without input, and fails', () => {
    const game = new StdGame(parseOsu(MAP.replace('HPDrainRate:5', 'HPDrainRate:8')), [], { startTime: 0, test: false });
    run(game);
    expect(game.counts.n300).toBe(0);
    expect(game.failed).toBe(true);
  });

  it('never fails in test mode, and skips what comes before the start', () => {
    const game = new StdGame(parseOsu(MAP), [], { startTime: 2600, test: true });
    run(game);
    expect(game.failed).toBe(false);
    expect(game.finished).toBe(true);
    expect(game.counts.nMiss).toBe(3);
  });

  it('judges clicks by their timing, with notelock', () => {
    const game = new StdGame(parseOsu(MAP), ['NF'], { startTime: 0, test: false });
    game.update(1990);
    // Clicking the second circle while the first can still be hit only shakes it.
    game.move({ x: 200, y: 100 });
    game.press(0, 1995);
    game.release(0);
    expect(game.counts.n300).toBe(0);
    game.move({ x: 100, y: 100 });
    game.press(0, 2010);
    game.release(0);
    game.update(2020);
    expect(game.counts.n300).toBe(1);
    game.move({ x: 200, y: 100 });
    game.press(1, 2560);
    game.release(1);
    expect(game.counts.n100).toBe(1);
    expect(game.combo).toBe(2);
  });
});
