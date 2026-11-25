import { describe, expect, it, vi } from 'vitest';
import { parseOsu } from '../osu/parser';

vi.mock('./store', () => ({ formatTimestamp: (t: number) => String(Math.round(t)), maniaColumn: () => 0 }));
const { runAiMod } = await import('./aimod');

function compose(cs: number, objects: string[]): string[] {
  const bm = parseOsu(`osu file format v14

[Difficulty]
CircleSize:${cs}
SliderMultiplier:1.4

[TimingPoints]
-630,342.857142857143,4,2,0,60,1,0

[HitObjects]
${objects.join('\n')}
`);
  return runAiMod({ files: new Map(), difficulties: [{ beatmap: bm }] } as never, bm)
    .filter((i) => i.category === 'Compose')
    .map((i) => i.message);
}

describe('runAiMod compose checks', () => {
  it('accepts times stable stores for a tick (cast to int) and within 2ms of it', () => {
    // Beat 115 is at 38798.57: stable saves 38797-38799 for it in old maps; 38800 is 1.43ms off.
    expect(compose(4, ['256,192,38797,1,0', '256,192,39141,1,0', '256,192,39484,1,0'])).toEqual([]);
  });

  it('flags a 3ms unsnap', () => {
    expect(compose(4, ['256,192,38802,1,0'])[0]).toMatch(/^Object is not snapped/);
  });

  it('allows objects on the playfield edge at any circle size', () => {
    expect(compose(2, ['0,0,38797,1,0', '512,0,39141,1,0', '256,0,39484,2,0,L|256:120,1,120', '256,380,40170,1,0'])).toEqual([]);
  });

  it('flags objects and slider bodies past what a 4:3 screen shows', () => {
    expect(compose(4, ['256,410,38797,1,0'])).toEqual(['Object is partially off-screen.']);
    expect(compose(4, ['200,20,38797,2,0,P|100:-60|0:20,1,250'])).toEqual(['Slider body goes off-screen.']);
  });
});
