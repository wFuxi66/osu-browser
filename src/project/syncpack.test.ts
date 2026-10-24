import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createEmptyBeatmap } from '../osu/types';
import { exportOsz, type Project } from './project';
import { buildSyncPackage, MANIFEST, originOf, restoreSyncPackage } from './syncpack';

const bytes = (s: string) => new Blob([new TextEncoder().encode(s)]);

function project(setId: number, files: Record<string, Blob>): Project {
  const bm = createEmptyBeatmap();
  bm.metadata.artist = 'Artist';
  bm.metadata.title = 'Song';
  bm.metadata.version = 'Insane';
  bm.metadata.beatmapSetId = setId;
  bm.general.audioFilename = 'audio.mp3';
  return { id: 'project-1', createdAt: 1, updatedAt: 2, files: new Map(Object.entries(files)), difficulties: [{ id: 'd', beatmap: bm }] };
}

const mirrorFiles = { 'audio.mp3': bytes('the song'), 'BG.jpg': bytes('background'), 'video.mp4': bytes('video') };
const mirrorOsz = async (files: Record<string, Blob>) => (await exportOsz(project(123, files))).arrayBuffer();
const names = async (b: Blob) => Object.keys((await JSZip.loadAsync(await b.arrayBuffer())).files).sort();

describe('cloud sync packages', () => {
  it('leaves out files the mirror serves unchanged and restores them from it', async () => {
    const p = project(123, {
      'audio.mp3': mirrorFiles['audio.mp3'],
      'bg.jpg': mirrorFiles['BG.jpg'], // same file, different case
      'soft-hitclap.wav': bytes('custom hitsound'), // added by the mapper
      'video.mp4': bytes('re-encoded video'), // replaced by the mapper
    });
    p.origin = await originOf(123, new Map(Object.entries(mirrorFiles)));
    const { blob: pkg, lite } = await buildSyncPackage(p);
    expect(lite).toBe(true);
    expect(await names(pkg)).toEqual([MANIFEST, 'Artist - Song () [Insane].osu', 'soft-hitclap.wav', 'video.mp4']);

    const { project: back, warnings } = await restoreSyncPackage(await pkg.arrayBuffer(), async (id) => {
      expect(id).toBe(123);
      return mirrorOsz(mirrorFiles);
    });
    expect(warnings).toEqual([]);
    expect([...back.files.keys()].sort()).toEqual(['audio.mp3', 'bg.jpg', 'soft-hitclap.wav', 'video.mp4']);
    expect(await back.files.get('audio.mp3')!.text()).toBe('the song');
    expect(await back.files.get('bg.jpg')!.text()).toBe('background');
    expect(await back.files.get('video.mp4')!.text()).toBe('re-encoded video');
    expect(back.difficulties[0].beatmap.metadata.version).toBe('Insane');
    expect(back.origin?.setId).toBe(123);
  });

  it('warns when the set changed on the mirrors since it was synced', async () => {
    const p = project(123, { 'audio.mp3': mirrorFiles['audio.mp3'], 'bg.jpg': mirrorFiles['BG.jpg'] });
    p.origin = await originOf(123, new Map(Object.entries(mirrorFiles)));
    const { blob: pkg } = await buildSyncPackage(p);
    const { project: back, warnings } = await restoreSyncPackage(await pkg.arrayBuffer(), () => mirrorOsz({ 'audio.mp3': bytes('remastered') }));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('bg.jpg');
    expect(warnings[1]).toContain('audio.mp3');
    expect(await back.files.get('audio.mp3')!.text()).toBe('remastered');
  });

  it('uploads original maps and sets the mirrors lack in full', async () => {
    const files = { 'audio.mp3': bytes('the song') };
    const original = project(0, files);
    original.origin = await originOf(123, new Map(Object.entries(files)));
    const unknown = project(123, files);
    unknown.origin = { setId: 123, files: null, checkedAt: 0 };
    for (const p of [original, unknown]) {
      const { blob: pkg, lite } = await buildSyncPackage(p);
      expect(lite).toBe(false);
      expect(await names(pkg)).toEqual(['Artist - Song () [Insane].osu', 'audio.mp3']);
      const { project: back } = await restoreSyncPackage(await pkg.arrayBuffer(), () => Promise.reject(new Error('no mirror needed')));
      expect([...back.files.keys()]).toEqual(['audio.mp3']);
    }
  });
});
