import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBeatmap } from '../osu/types';

const { cloud, remove, save, trashed } = vi.hoisted(() => {
  const remove = vi.fn(async (_id: string) => true);
  return { remove, save: vi.fn(async () => undefined as void), cloud: { driveConnected: true, user: null, remove }, trashed: [] as string[] };
});

vi.mock('../editor/store', () => ({ editor: { project: null, prefs: { creatorName: '' } } }));
vi.mock('./cloud', () => ({ cloud }));
vi.mock('./storage', () => ({
  listProjectsLocal: async () => [{ id: 'old', beatmapSetId: 5 }],
  loadProjectLocal: async () => null,
  saveProjectLocal: save,
  trashProjectLocal: async (id: string) => void trashed.push(id),
}));
vi.mock('./project', () => ({
  createProjectFromAudio: async () => null,
  importLooseFiles: async () => null,
  keepDifficultyIds: () => undefined,
  importOsz: async () => {
    const beatmap = createEmptyBeatmap();
    beatmap.metadata.beatmapSetId = 5;
    return { id: 'new', files: new Map(), difficulties: [{ id: 'd', beatmap }] };
  },
}));

const { projectFromFiles } = await import('./open');

describe('importing a set you already have', () => {
  beforeEach(() => {
    remove.mockClear();
    trashed.length = 0;
  });

  it("removes the replaced copy from Drive too, so it can't come back", async () => {
    const r = await projectFromFiles([new File(['x'], 'set.osz')]);
    expect(r.replaced).toBe(1);
    expect(trashed).toEqual(['old']);
    expect(remove).toHaveBeenCalledWith('old');
  });

  it('leaves Drive alone when it is not connected', async () => {
    cloud.driveConnected = false;
    await projectFromFiles([new File(['x'], 'set.osz')]);
    expect(remove).not.toHaveBeenCalled();
    cloud.driveConnected = true;
  });

  it('keeps the copy you have, here and in Drive, when the new one fails to save', async () => {
    save.mockRejectedValueOnce(new Error('full'));
    await expect(projectFromFiles([new File(['x'], 'set.osz')])).rejects.toThrow('full');
    expect(trashed).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
