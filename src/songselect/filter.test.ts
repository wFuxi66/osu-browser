import { describe, expect, it } from 'vitest';
import { beatmapInfo, formatBpm, formatLength } from '../osu/info';
import { createEmptyBeatmap, defaultSample, newObjectId } from '../osu/types';
import type { DifficultySummary, ProjectSummary } from '../project/storage';
import { groupOf, matches, parseSearch, sortSets } from './filter';

function diff(over: Partial<DifficultySummary> = {}): DifficultySummary {
  return { id: 'd', version: 'Insane', mode: 0, hp: 5, cs: 4, od: 8, ar: 9, circles: 10, sliders: 5, spinners: 1, length: 90000, bpmMin: 180, bpmMax: 180, bpmMain: 180, previewTime: -1, stars: null, ...over };
}

function set(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 's', title: 'A - B', artist: 'Adust Rain', songTitle: 'Misery Song', artistUnicode: 'Adust Rain', titleUnicode: 'Misery Song',
    creator: 'Fuxi66', source: '', tags: 'judgement', beatmapSetId: 0, createdAt: 1, updatedAt: 1, syncedAt: 0,
    difficulties: [diff()], background: null, audio: null, ...over,
  };
}

describe('song select search', () => {
  it('matches words against metadata and the difficulty name', () => {
    expect(matches(set(), diff(), parseSearch('misery fuxi'))).toBe(true);
    expect(matches(set(), diff(), parseSearch('insane judgement'))).toBe(true);
    expect(matches(set(), diff(), parseSearch('kokoro'))).toBe(false);
  });

  it('supports stable-style filters', () => {
    expect(matches(set(), diff(), parseSearch('ar>8.5 od<=8 bpm=180'))).toBe(true);
    expect(matches(set(), diff(), parseSearch('ar>9'))).toBe(false);
    expect(matches(set(), diff(), parseSearch('length<60'))).toBe(false);
    expect(matches(set(), diff({ mode: 3, cs: 7 }), parseSearch('keys=7 mode=mania'))).toBe(true);
    expect(matches(set(), diff(), parseSearch('creator=fuxi'))).toBe(true);
    // Decimal commas, as typed on a French keyboard.
    expect(matches(set(), diff(), parseSearch('ar>=8,9'))).toBe(true);
  });

  it('sorts and groups sets', () => {
    const a = set({ id: 'a', artist: 'Zed', songTitle: 'One', createdAt: 1 });
    const b = set({ id: 'b', artist: 'abc', songTitle: 'Two', createdAt: 2 });
    expect(sortSets([a, b], 'artist').map((s) => s.id)).toEqual(['b', 'a']);
    expect(sortSets([a, b], 'date').map((s) => s.id)).toEqual(['b', 'a']);
    expect(groupOf(b, 'artist').key).toBe('A');
    expect(groupOf(set({ difficulties: [diff({ bpmMain: 205 })] }), 'bpm').key).toBe('Under 240 BPM');
  });
});

describe('beatmap info', () => {
  it('counts objects and measures length and BPM like stable', () => {
    const bm = createEmptyBeatmap();
    bm.timingPoints = [
      { time: 1000, beatLength: 60000 / 200, meter: 4, sampleSet: 0, sampleIndex: 0, volume: 100, uninherited: true, kiai: false, omitFirstBarLine: false },
      { time: 61000, beatLength: 60000 / 100, meter: 4, sampleSet: 0, sampleIndex: 0, volume: 100, uninherited: true, kiai: false, omitFirstBarLine: false },
    ];
    const base = { newCombo: false, comboSkip: 0, hitSound: 0, sample: defaultSample(), x: 256, y: 192 };
    bm.hitObjects = [
      { ...base, id: newObjectId(), kind: 'circle', time: 1000 },
      { ...base, id: newObjectId(), kind: 'circle', time: 30000 },
      { ...base, id: newObjectId(), kind: 'spinner', time: 70000, endTime: 75999 },
    ];
    const i = beatmapInfo(bm);
    expect([i.circles, i.sliders, i.spinners]).toEqual([2, 0, 1]);
    expect(formatLength(i.length)).toBe('01:15');
    expect(i.bpmMain).toBe(200);
    expect(formatBpm(i)).toBe('100-200 (200)');
  });
});
