import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBeatmap } from '../osu/types';
import type { Project } from '../project/project';

const { music, saveProjectLocal, prompt } = vi.hoisted(() => ({
  music: { offset: 0, volume: 1, time: 0, duration: 0, playing: false, pause: () => undefined, seek: () => undefined, load: async () => undefined },
  saveProjectLocal: vi.fn(async () => undefined as void),
  prompt: { answer: 'yes' },
}));

vi.stubGlobal('window', { addEventListener: () => undefined });
vi.mock('../audio/music', () => ({ music, GLIDE_MS: 200, glideLeft: () => 0, reducedMotion: () => true }));
vi.mock('../audio/hitsounds', () => ({ hitsounds: { setVolume: () => undefined, setCustomSamples: async () => undefined } }));
vi.mock('../skin/skin', () => ({ skins: { use: async () => undefined, setBeatmap: async () => undefined } }));
vi.mock('../ui/prompt', () => ({ ask: async () => prompt.answer }));
vi.mock('../ui/touch', () => ({ touchedRecently: () => false }));
vi.mock('../project/cloud', () => ({ cloud: { syncing: false, available: false, driveConfigured: false } }));
vi.mock('../project/storage', () => ({
  loadPrefs: () => ({ masterVolume: 1, musicVolume: 1, hitsoundVolume: 1, audioOffset: 10, beatmapSkins: false, skin: 'default', syncSettings: false }),
  savePrefs: () => undefined,
  loadProjectLocal: async () => null,
  saveProjectLocal,
}));

const { editor } = await import('./store');

function project(formatVersions: number[]): Project {
  const difficulties = formatVersions.map((v, i) => {
    const beatmap = createEmptyBeatmap();
    beatmap.formatVersion = v;
    return { id: `d${i}`, beatmap };
  });
  return { id: 'p', createdAt: 1, updatedAt: 1, files: new Map(), difficulties };
}

describe('leaving the editor', () => {
  beforeEach(async () => {
    saveProjectLocal.mockReset();
    prompt.answer = 'yes';
    await editor.openProject(project([14]));
    editor.markDirty();
  });

  it('stays open with the changes when the save it asked for fails', async () => {
    saveProjectLocal.mockRejectedValueOnce(new Error('full'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined);
    await editor.exitEditor();
    expect(editor.project).not.toBeNull();
    expect(editor.dirty).toBe(true);
  });

  it('closes after a save that worked', async () => {
    await editor.exitEditor();
    expect(saveProjectLocal).toHaveBeenCalledOnce();
    expect(editor.project).toBeNull();
  });
});

describe('adding a timing point', () => {
  it('replaces a point of the same type at a fraction of that millisecond', async () => {
    const p = project([14]);
    const line = { time: 1000.4, beatLength: 500, meter: 4, sampleSet: 0 as const, sampleIndex: 0, volume: 100, kiai: false, omitFirstBarLine: false };
    p.difficulties[0].beatmap.timingPoints = [
      { ...line, uninherited: true },
      { ...line, beatLength: -100, uninherited: false },
    ];
    await editor.openProject(p);
    editor.addTimingPoint(true, 1000);
    expect(editor.bm.timingPoints.map((t) => [t.time, t.uninherited])).toEqual([
      [1000, true],
      [1000.4, false],
    ]);
  });
});

describe('the audio offset of a file format', () => {
  it('adds 24 ms below format v5, for the difficulty that is open, until the map closes', async () => {
    await editor.openProject(project([4, 14]));
    expect(music.offset).toBe(34);
    await editor.switchDifficulty(1);
    expect(music.offset).toBe(10);
    await editor.switchDifficulty(0);
    expect(music.offset).toBe(34);
    editor.closeProject();
    expect(music.offset).toBe(10);
  });
});
