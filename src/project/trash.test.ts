import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBeatmap } from '../osu/types';
import type { Project } from './project';

// A small in-memory IndexedDB: enough of it for storage.ts (one store keyed by id, requests answered in order).
const data = new Map<string, { id: string; deletedAt?: number }>();
class FakeTx {
  pending = 0;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error = null;
  constructor() {
    setTimeout(() => this.settle());
  }
  settle() {
    if (this.pending === 0) setTimeout(() => this.pending === 0 && this.oncomplete?.());
  }
  objectStore() {
    const req = <T,>(fn: () => T) => {
      const r: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
      this.pending++;
      setTimeout(() => {
        r.result = fn();
        r.onsuccess?.();
        this.pending--;
        this.settle();
      });
      return r;
    };
    return {
      get: (id: string) => req(() => structuredClone(data.get(id))),
      getAll: () => req(() => [...data.values()].map((v) => structuredClone(v))),
      put: (v: { id: string }) => {
        const copy = structuredClone(v);
        return req(() => void data.set(copy.id, copy));
      },
      delete: (id: string) => req(() => void data.delete(id)),
    };
  }
}
vi.stubGlobal('indexedDB', {
  open: () => {
    const r: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = {};
    setTimeout(() => {
      r.result = { transaction: () => new FakeTx(), createObjectStore: () => undefined };
      r.onupgradeneeded?.();
      r.onsuccess?.();
    });
    return r;
  },
});
let estimate: { usage: number; quota: number } | null = null;
vi.stubGlobal('navigator', { storage: { estimate: async () => estimate ?? {} } });

const storage = await import('./storage');
const { cleanUpTrash, listProjectsLocal, listTrashLocal, loadProjectLocal, restoreTrashLocal, saveProjectLocal, trashDifficultyLocal, trashProjectLocal, trashToRemove } = storage;

const DAY = 24 * 60 * 60 * 1000;

function diff(id: string, version: string, background: string) {
  const bm = createEmptyBeatmap();
  bm.metadata.artist = 'Artist';
  bm.metadata.title = 'Song';
  bm.metadata.version = version;
  bm.events.background = { filename: background, x: 0, y: 0 };
  return { id, beatmap: bm };
}

/** A synced two-difficulty set: both use audio.mp3; [Hard] alone uses hard.jpg. */
async function addSet(id: string, syncedAt = 100): Promise<Project> {
  const p: Project = {
    id,
    createdAt: 1,
    updatedAt: syncedAt,
    files: new Map([
      ['audio.mp3', new Blob(['song'])],
      ['bg.jpg', new Blob(['bg'])],
      ['hard.jpg', new Blob(['hard bg'])],
    ]),
    difficulties: [diff(`${id}-normal`, 'Normal', 'bg.jpg'), diff(`${id}-hard`, 'Hard', 'hard.jpg')],
  };
  await saveProjectLocal(p, syncedAt);
  return p;
}

const versions = (p: Project | null) => p?.difficulties.map((d) => d.beatmap.metadata.version).sort();
const files = (p: Project | null) => [...(p?.files.keys() ?? [])].sort();

describe('Recently deleted', () => {
  beforeEach(() => {
    data.clear();
    estimate = null;
  });

  it('hides a deleted set from the song list and from opening, and lists it in Recently deleted', async () => {
    await addSet('a');
    await addSet('b');
    await trashProjectLocal('a');
    expect((await listProjectsLocal()).map((s) => s.id)).toEqual(['b']);
    expect(await loadProjectLocal('a')).toBeNull();
    expect(await listTrashLocal()).toMatchObject([{ id: 'a', setId: 'a', title: 'Artist - Song', version: null, syncedAt: 100 }]);
  });

  it('restoring a set counts as a new save, so the next sync uploads it', async () => {
    await addSet('a');
    await trashProjectLocal('a');
    const p = await restoreTrashLocal('a');
    expect(p?.id).toBe('a');
    const [s] = await listProjectsLocal();
    expect(s.id).toBe('a');
    expect(s.updatedAt).toBeGreaterThan(s.syncedAt);
    expect(await listTrashLocal()).toEqual([]);
  });

  it('a deleted difficulty takes the files only it used, and restores into its set', async () => {
    await addSet('a');
    const left = await trashDifficultyLocal('a', 'a-hard');
    expect(versions(left)).toEqual(['Normal']);
    expect(files(left)).toEqual(['audio.mp3', 'bg.jpg']);
    expect(await listTrashLocal()).toMatchObject([{ setId: 'a', version: 'Hard' }]);
    const [entry] = await listTrashLocal();
    const back = await restoreTrashLocal(entry.id);
    expect(versions(back)).toEqual(['Hard', 'Normal']);
    expect(files(back)).toEqual(['audio.mp3', 'bg.jpg', 'hard.jpg']);
    expect(versions(await loadProjectLocal('a'))).toEqual(['Hard', 'Normal']);
    expect(await listTrashLocal()).toEqual([]);
  });

  it('restoring a difficulty of a deleted set restores the set too', async () => {
    await addSet('a');
    await trashDifficultyLocal('a', 'a-hard');
    await trashProjectLocal('a');
    expect(await listProjectsLocal()).toEqual([]);
    const entry = (await listTrashLocal()).find((e) => e.version === 'Hard')!;
    await restoreTrashLocal(entry.id);
    const [s] = await listProjectsLocal();
    expect(s.id).toBe('a');
    expect(s.difficulties.map((d) => d.version).sort()).toEqual(['Hard', 'Normal']);
    expect(s.updatedAt).toBeGreaterThan(s.syncedAt);
    expect(await listTrashLocal()).toEqual([]);
  });

  it(`removes what was deleted more than ${storage.TRASH_DAYS} days ago`, async () => {
    await addSet('old');
    await addSet('new');
    await trashProjectLocal('old');
    const t = Date.now();
    await trashDifficultyLocal('new', 'new-hard');
    // Recently deleted as seen 31 days after "old" was deleted, the difficulty 29 days later.
    data.get('old')!.deletedAt = t - 31 * DAY;
    await cleanUpTrash(t);
    expect((await listTrashLocal()).map((e) => e.version)).toEqual(['Hard']);
    expect(data.has('old')).toBe(false);
    expect((await listProjectsLocal()).map((s) => s.id)).toEqual(['new']);
  });

  it('removes the oldest deleted maps first while storage is nearly full', async () => {
    for (const id of ['a', 'b', 'c']) await addSet(id);
    const t = Date.now();
    for (const [id, age] of [['a', 3], ['b', 1], ['c', 2]] as const) {
      await trashProjectLocal(id);
      data.get(id)!.deletedAt = t - age * DAY;
    }
    const size = (await listTrashLocal())[0].size;
    // Over 80% of the quota by just under two sets' worth: the two oldest go, the newest stays.
    estimate = { usage: 800 + 2 * size - 1, quota: 1000 };
    await cleanUpTrash(t);
    expect((await listTrashLocal()).map((e) => e.id)).toEqual(['b']);
    estimate = { usage: 100, quota: 1000 };
    await cleanUpTrash(t);
    expect((await listTrashLocal()).map((e) => e.id)).toEqual(['b']);
  });

  it('trashToRemove: expired entries, then oldest first until under the limit', () => {
    const now = 100 * DAY;
    const entries = [
      { id: 'new', deletedAt: now - DAY, size: 50 },
      { id: 'expired', deletedAt: now - 40 * DAY, size: 10 },
      { id: 'mid', deletedAt: now - 5 * DAY, size: 30 },
    ];
    expect(trashToRemove(entries, now)).toEqual(['expired']);
    expect(trashToRemove(entries, now, 70, 100)).toEqual(['expired']);
    expect(trashToRemove(entries, now, 95, 100)).toEqual(['expired', 'mid']);
    expect(trashToRemove(entries, now, 200, 100)).toEqual(['expired', 'mid', 'new']);
  });
});
