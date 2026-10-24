import { describe, expect, it } from 'vitest';
import { getSliderPath, SliderPath } from './curves';
import { parseOsu } from './parser';
import { processBeatmap } from './processing';
import { serializeBeatmap } from './serializer';
import { redLineAt, sliderDuration, snapTime, stepTick, svAt } from './timing';
import type { Slider } from './types';

const SAMPLE = `osu file format v14

[General]
AudioFilename: audio.mp3
AudioLeadIn: 0
PreviewTime: 12345
Countdown: 0
SampleSet: Soft
StackLeniency: 0.7
Mode: 0
LetterboxInBreaks: 0
WidescreenStoryboard: 1

[Editor]
Bookmarks: 1000,5000
DistanceSpacing: 1.2
BeatDivisor: 4
GridSize: 16
TimelineZoom: 1.5

[Metadata]
Title:Test Song
TitleUnicode:テスト
Artist:Someone
ArtistUnicode:誰か
Creator:mapper
Version:Insane
Source:
Tags:tag1 tag2
BeatmapID:123
BeatmapSetID:456

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:9
SliderMultiplier:1.8
SliderTickRate:1

[Events]
//Background and Video events
0,0,"bg.jpg",0,0
//Break Periods
2,20000,25000
//Storyboard Layer 0 (Background)
Sprite,Background,Centre,"sb/a.png",320,240
 F,0,1000,2000,0,1
//Storyboard Layer 1 (Fail)
//Storyboard Layer 2 (Pass)
//Storyboard Layer 3 (Foreground)
//Storyboard Layer 4 (Overlay)
//Storyboard Sound Samples

[TimingPoints]
1000,500,4,2,0,70,1,0
3000,-50,4,2,1,60,0,1
9000,400,3,1,0,80,1,8

[Colours]
Combo1 : 255,0,0
Combo2 : 0,255,0

[HitObjects]
256,192,1000,5,2,0:0:0:0:
300,200,1500,2,0,B|350:250|400:200,2,180,2|0|8,1:2|0:0|2:0,0:0:0:0:
300,200,2000,1,0,0:0:0:0:
256,192,4000,12,0,6000,0:0:0:0:
100,100,9000,6,0,P|150:50|200:100,1,140
`;

describe('parser/serializer', () => {
  it('parses all sections', () => {
    const bm = parseOsu(SAMPLE);
    expect(bm.general.previewTime).toBe(12345);
    expect(bm.editor.bookmarks).toEqual([1000, 5000]);
    expect(bm.metadata.titleUnicode).toBe('テスト');
    expect(bm.difficulty.sliderMultiplier).toBe(1.8);
    expect(bm.events.background?.filename).toBe('bg.jpg');
    expect(bm.events.breaks).toEqual([{ start: 20000, end: 25000 }]);
    expect(bm.events.storyboardLines).toEqual(['Sprite,Background,Centre,"sb/a.png",320,240', ' F,0,1000,2000,0,1']);
    expect(bm.timingPoints).toHaveLength(3);
    expect(bm.timingPoints[1].kiai).toBe(true);
    expect(bm.timingPoints[2].omitFirstBarLine).toBe(true);
    expect(bm.colours.combo).toHaveLength(2);
    expect(bm.hitObjects.map((o) => o.kind)).toEqual(['circle', 'slider', 'circle', 'spinner', 'slider']);
    const s = bm.hitObjects[1] as Slider;
    expect(s.slides).toBe(2);
    expect(s.edgeSounds).toEqual([2, 0, 8]);
    expect(s.edgeSets[0]).toEqual({ normal: 1, addition: 2 });
    expect(bm.hitObjects[0].newCombo).toBe(true);
    expect(bm.hitObjects[3].newCombo).toBe(true);
  });

  it('round-trips through the serializer', () => {
    const bm = parseOsu(SAMPLE);
    const text = serializeBeatmap(bm);
    const again = parseOsu(text);
    const strip = (b: typeof bm) => JSON.parse(JSON.stringify({ ...b, hitObjects: b.hitObjects.map(({ id: _id, ...rest }) => rest) }));
    expect(strip(again)).toEqual(strip(bm));
    expect(text).toContain('Sprite,Background,Centre,"sb/a.png",320,240\r\n F,0,1000,2000,0,1');
    // Serializing twice is stable.
    expect(serializeBeatmap(again)).toBe(text);
  });
});

describe('timing', () => {
  const bm = parseOsu(SAMPLE);
  it('finds red lines and SV', () => {
    expect(redLineAt(bm, 2000).beatLength).toBe(500);
    expect(redLineAt(bm, 9500).beatLength).toBe(400);
    expect(svAt(bm, 2000)).toBe(1);
    expect(svAt(bm, 3500)).toBe(2);
    expect(svAt(bm, 9500)).toBe(1);
  });
  it('snaps and steps ticks', () => {
    expect(snapTime(bm, 1130, 4)).toBe(1125);
    expect(snapTime(bm, 1130, 1)).toBe(1000);
    expect(stepTick(bm, 1000, 4, 1)).toBe(1125);
    expect(stepTick(bm, 1125, 4, -1)).toBe(1000);
    expect(stepTick(bm, 8990, 1, 1)).toBe(9000);
  });
  it('computes slider duration from SV', () => {
    const s = bm.hitObjects[1] as Slider;
    // 180px at 1.8 * 100 px/beat = 1 beat per span, 2 spans
    expect(sliderDuration(bm, s)).toBeCloseTo(1000);
  });
});

describe('curves', () => {
  it('linear paths are clipped to the expected length', () => {
    const p = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 50);
    expect(p.length).toBe(50);
    expect(p.positionAt(1)).toEqual({ x: 50, y: 0 });
  });
  it('linear paths are extended when too short', () => {
    const p = new SliderPath('L', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 150);
    expect(p.positionAt(1).x).toBeCloseTo(150);
  });
  it('perfect circle passes through its control points', () => {
    const p = new SliderPath('P', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }]);
    expect(p.length).toBeCloseTo(Math.PI * 50, 0);
    const mid = p.positionAt(0.5);
    expect(mid.x).toBeCloseTo(50, 0);
    expect(mid.y).toBeCloseTo(50, 0);
  });
  it('bezier ends at the last control point', () => {
    const p = new SliderPath('B', [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }]);
    const end = p.positionAt(1);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
  });
  it('red anchors split bezier segments', () => {
    const p = new SliderPath('B', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(p.length).toBeCloseTo(200);
  });
  it('caches slider paths per object', () => {
    const bm = parseOsu(SAMPLE);
    const s = bm.hitObjects[1] as Slider;
    expect(getSliderPath(s)).toBe(getSliderPath(s));
  });
});

describe('processing', () => {
  it('assigns combo numbers and stacks', () => {
    const bm = parseOsu(SAMPLE);
    bm.hitObjects.push({ ...bm.hitObjects[0], id: 9999, time: 1100, newCombo: false });
    bm.hitObjects.sort((a, b) => a.time - b.time);
    const p = processBeatmap(bm);
    const nums = bm.hitObjects.map((o) => p.info.get(o.id)!.comboNumber);
    expect(nums).toEqual([1, 2, 3, 4, 0, 1]);
    // Two circles at the same spot 100ms apart stack.
    expect(p.info.get(bm.hitObjects[0].id)!.stackHeight).toBe(1);
  });
});
