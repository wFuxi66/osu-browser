import { describe, expect, it } from 'vitest';
import {
  animationFrameFile,
  compileSprite,
  ease,
  parseOsb,
  parseStoryboardLines,
  serializeOsb,
  serializeStoryboardLines,
  spriteStateAt,
  triggerMatches,
  type SbSprite,
} from './storyboard';

const OSB = `[Variables]
$bg="sb/bg.png"

[Events]
//Background and Video events
//Storyboard Layer 0 (Background)
Sprite,Background,Centre,$bg,320,240
 F,0,1000,2000,0,1
 M,1,1000,2000,0,0,100,200
 S,0,1000,,0.5
 L,3000,2
  R,0,0,500,0,3.14
 P,0,1000,1500,H
//Storyboard Layer 1 (Fail)
//Storyboard Layer 2 (Pass)
//Storyboard Layer 3 (Foreground)
Animation,Foreground,TopLeft,"sb/fire.png",10,20,4,100,LoopOnce
 F,0,0,5000,1
//Storyboard Layer 4 (Overlay)
//Storyboard Sound Samples
Sample,500,0,"sb/boom.wav",80
`;

describe('storyboard parsing', () => {
  const sb = parseOsb(OSB);
  const bg = sb.elements[0] as SbSprite;

  it('reads elements, variables and commands', () => {
    expect(sb.elements).toHaveLength(3);
    expect(bg.file).toBe('sb/bg.png');
    expect(bg.origin).toBe('Centre');
    expect(bg.commands.map((c) => c.type)).toEqual(['F', 'M', 'S', 'L', 'P']);
    const loop = bg.commands[3];
    expect(loop.type === 'L' && loop.commands.length).toBe(1);
    expect(sb.elements[2]).toMatchObject({ kind: 'sample', time: 500, file: 'sb/boom.wav', volume: 80 });
  });

  it('expands chained values', () => {
    const { elements } = parseStoryboardLines(['Sprite,Pass,Centre,"a.png",0,0', ' F,0,0,100,0,1,0.5']);
    const cmds = (elements[0] as SbSprite).commands;
    expect(cmds).toMatchObject([
      { start: 0, end: 100, from: [0], to: [1] },
      { start: 100, end: 200, from: [1], to: [0.5] },
    ]);
  });

  it('evaluates timelines with easing, loops and parameters', () => {
    const c = compileSprite(bg);
    expect(spriteStateAt(c, 999)).toBeNull();
    const mid = spriteStateAt(c, 1500)!;
    expect(mid.alpha).toBeCloseTo(0.5);
    expect(mid.x).toBeCloseTo(100 * ease(1, 0.5));
    expect(mid.scaleX).toBe(0.5);
    expect(spriteStateAt(c, 1400)!.flipH).toBe(true);
    expect(spriteStateAt(c, 1600)!.flipH).toBe(false);
    // Before the loop starts the first rotation value applies; second iteration starts at 3500.
    expect(spriteStateAt(c, 2500)!.rotation).toBe(0);
    expect(spriteStateAt(c, 3750)!.rotation).toBeCloseTo(1.57);
    expect(c.end).toBe(4000);
  });

  it('picks animation frames', () => {
    const anim = sb.elements[1] as SbSprite;
    expect(animationFrameFile(anim, 0, 250)).toBe('sb/fire2.png');
    expect(animationFrameFile(anim, 0, 900)).toBe('sb/fire3.png');
  });

  it('round-trips through serialization', () => {
    const again = parseOsb(serializeOsb(sb));
    expect(serializeStoryboardLines(again)).toEqual(serializeStoryboardLines(sb));
  });

  it('fires hitsound triggers', () => {
    const { elements } = parseStoryboardLines(['Sprite,Pass,Centre,"a.png",0,0', ' T,HitSoundClap,0,10000', '  F,0,0,100,1,0']);
    const hit = { normalSet: 2, additionSet: 2, additions: 8, index: 0 };
    const c = compileSprite(elements[0] as SbSprite, [{ time: 1000, ...hit }, { time: 3000, ...hit, additions: 2 }]);
    expect(spriteStateAt(c, 1050)!.alpha).toBeCloseTo(0.5);
    expect(spriteStateAt(c, 3050)).toBeNull();
    expect(triggerMatches('HitSoundSoftWhistle', { time: 0, normalSet: 1, additionSet: 2, additions: 2, index: 0 })).toBe(true);
    expect(triggerMatches('HitSoundDrum', { time: 0, normalSet: 1, additionSet: 2, additions: 2, index: 0 })).toBe(false);
  });
});
