import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveProject } from './drive';
import type { Project } from './project';

// An in-memory Drive and browser store: what each side holds, by project id.
interface Local {
  updatedAt: number;
  syncedAt: number;
  tag: string;
  /** In Recently deleted. */
  deletedAt?: number;
  diffIds?: string[];
}
const remote = new Map<string, DriveProject & { tag: string }>();
const local = new Map<string, Local>();
const removed: string[] = [];

const project = (id: string, l: { updatedAt: number; tag: string }): Project =>
  ({ id, createdAt: 1, updatedAt: l.updatedAt, files: new Map([['tag', new Blob([l.tag])]]), difficulties: [] }) as unknown as Project;
const tagOf = async (p: Project) => (await p.files.get('tag')?.text()) ?? '';
const hard = (id: string) => ({ id, beatmap: { metadata: { beatmapId: 7, version: 'Hard' } } });
/** Runs while a download from Drive is under way. */
let duringDownload: (() => void) | null = null;
/** Runs once, while an upload looks up Drive's copy of its map. */
let duringGet: (() => void) | null = null;

vi.mock('./drive', () => ({
  drive: {
    list: async () => [...remote.values()],
    get: async (id: string) => {
      duringGet?.();
      duringGet = null;
      return remote.get(id) ?? null;
    },
    upload: async (meta: { id: string; updatedAt: number }, blob: Blob) => {
      remote.set(meta.id, { fileId: `f-${meta.id}`, id: meta.id, title: meta.id, createdAt: 1, updatedAt: meta.updatedAt, size: 0, tag: await blob.text() });
    },
    download: async (fileId: string) => {
      duringDownload?.();
      return [...remote.values()].find((r) => r.fileId === fileId)!.tag;
    },
    remove: async (id: string) => {
      removed.push(id);
      remote.delete(id);
    },
  },
}));
vi.mock('./syncpack', () => ({
  setIdOf: () => 0,
  originOf: async () => ({}),
  buildSyncPackage: async (p: Project) => ({ blob: new Blob([await tagOf(p)]), lite: false }),
  restoreSyncPackage: async (tag: string) => ({ project: { ...project('', { updatedAt: 0, tag }), difficulties: [hard('new-id')] }, warnings: [] }),
}));
vi.mock('./storage', () => ({
  listProjectsLocal: async () => [...local].filter(([, l]) => !l.deletedAt).map(([id, l]) => ({ id, ...l })),
  listTrashLocal: async () =>
    [...local].filter(([, l]) => l.deletedAt).map(([id, l]) => ({ id, setId: id, title: id, version: null, deletedAt: l.deletedAt, syncedAt: l.syncedAt, size: 0 })),
  loadProjectLocal: async (id: string) => (local.has(id) && !local.get(id)!.deletedAt ? project(id, local.get(id)!) : null),
  saveProjectLocal: async (p: Project, syncedAt?: number) => {
    local.set(p.id, { updatedAt: p.updatedAt, syncedAt: syncedAt ?? local.get(p.id)?.syncedAt ?? 0, tag: await tagOf(p), diffIds: p.difficulties.map((d) => d.id) });
  },
  storedVersion: async (id: string) => {
    const l = local.get(id);
    return l ? { updatedAt: l.updatedAt, deleted: !!l.deletedAt } : null;
  },
  storedDifficulties: async (id: string) => (local.has(id) ? [hard('kept-id')] : []),
  markSynced: async (id: string, at: number) => {
    local.get(id)!.syncedAt = at;
  },
  syncedAtLocal: async (id: string) => local.get(id)?.syncedAt ?? 0,
  saveOriginLocal: async () => undefined,
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
});

const { cloud } = await import('./cloud');

/** A map both sides last synced at `t`. */
function synced(id: string, t: number, tag = 'v1') {
  remote.set(id, { fileId: `f-${id}`, id, title: id, createdAt: 1, updatedAt: t, size: 0, tag });
  local.set(id, { updatedAt: t, syncedAt: t, tag });
}
const tags = () => [...local.values()].map((l) => l.tag).sort();

describe('Drive sync never replaces unsynced work', () => {
  beforeEach(() => {
    remote.clear();
    local.clear();
    removed.length = 0;
    duringDownload = null;
    duringGet = null;
    store.clear();
    cloud.driveConnected = true;
    cloud.offline = false;
    cloud.isOpen = () => false;
  });

  it('sends a map changed on one side only to the other', async () => {
    synced('a', 100);
    synced('b', 100);
    local.set('a', { updatedAt: 200, syncedAt: 100, tag: 'a edited here' });
    remote.set('b', { ...remote.get('b')!, updatedAt: 300, tag: 'b edited elsewhere' });
    await cloud.syncAll();
    expect(remote.get('a')!.tag).toBe('a edited here');
    expect(local.get('b')!.tag).toBe('b edited elsewhere');
    expect(local.size).toBe(2);
  });

  it('keeps both versions of a map changed on both sides, even when the other one is newer', async () => {
    synced('c', 100);
    local.set('c', { updatedAt: 150, syncedAt: 100, tag: 'offline edit' });
    remote.set('c', { ...remote.get('c')!, updatedAt: 900, tag: 'edit on the pc' });
    const conflicts: string[] = [];
    cloud.onConflict = (t) => conflicts.push(t);
    await cloud.syncAll();
    expect(tags()).toEqual(['edit on the pc', 'offline edit']);
    expect(local.get('c')!.tag).toBe('offline edit');
    expect(conflicts).toEqual(['c']);
    await vi.waitFor(() => expect([...remote.values()].map((r) => r.tag).sort()).toEqual(['edit on the pc', 'offline edit']));
  });

  it("doesn't trust the clocks: an edit stamped earlier than the synced version still counts", async () => {
    synced('a', 500);
    remote.set('a', { ...remote.get('a')!, updatedAt: 400, tag: 'saved by a device whose clock is behind' });
    await cloud.syncAll();
    expect(local.get('a')!.tag).toBe('saved by a device whose clock is behind');
  });

  it('a save keeps the version another device put in Drive since the last sync', async () => {
    synced('d', 100);
    remote.set('d', { ...remote.get('d')!, updatedAt: 300, tag: 'edit on the pc' });
    local.set('d', { updatedAt: 200, syncedAt: 100, tag: 'edit here' });
    await cloud.upload('d');
    expect(remote.get('d')!.tag).toBe('edit here');
    expect(tags()).toEqual(['edit here', 'edit on the pc']);
  });

  it('uploads the saved copy, never edits made in the editor since the save', async () => {
    synced('e', 100);
    local.set('e', { updatedAt: 200, syncedAt: 100, tag: 'saved' });
    // The editor's copy goes on changing while the upload runs.
    const open = project('e', local.get('e')!);
    duringGet = () => {
      open.updatedAt = 300;
      open.files.set('tag', new Blob(['edited, not saved']));
    };
    await cloud.upload(open.id);
    expect(remote.get('e')).toMatchObject({ updatedAt: 200, tag: 'saved' });
  });

  it('a save made during an upload is sent after it, with no conflict copy', async () => {
    synced('f', 100);
    local.set('f', { updatedAt: 200, syncedAt: 100, tag: 'first save' });
    let second: Promise<void> | undefined;
    duringGet = () => {
      local.set('f', { ...local.get('f')!, updatedAt: 300, tag: 'second save' });
      second = cloud.upload('f');
    };
    await cloud.upload('f');
    await second;
    expect(remote.get('f')).toMatchObject({ updatedAt: 300, tag: 'second save' });
    expect(tags()).toEqual(['second save']);
  });

  it('leaves the map open in the editor alone', async () => {
    synced('a', 100);
    remote.set('a', { ...remote.get('a')!, updatedAt: 300, tag: 'edit on the pc' });
    cloud.isOpen = (id) => id === 'a';
    await cloud.syncAll();
    expect(local.get('a')!.tag).toBe('v1');
  });

  it('removes maps deleted offline from Drive once back online, instead of downloading them again', async () => {
    synced('a', 100);
    local.delete('a');
    cloud.offline = true;
    expect(await cloud.remove('a')).toBe(false);
    expect(removed).toEqual([]);
    cloud.offline = false;
    await cloud.syncAll();
    expect(removed).toEqual(['a']);
    expect(local.has('a')).toBe(false);
  });

  it('leaves a set in Recently deleted alone: not uploaded, not downloaded again', async () => {
    synced('a', 100);
    local.set('a', { updatedAt: 200, syncedAt: 100, tag: 'edited, then deleted', deletedAt: 300 });
    expect(await cloud.syncAll()).toBe(0);
    expect(local.get('a')).toMatchObject({ tag: 'edited, then deleted', deletedAt: 300 });
    expect(remote.get('a')!.tag).toBe('v1');
  });

  it('a newer version of a deleted set from another device replaces the deleted one', async () => {
    synced('a', 100);
    local.set('a', { ...local.get('a')!, deletedAt: 300 });
    remote.set('a', { ...remote.get('a')!, updatedAt: 400, tag: 'still mapping it on the pc' });
    await cloud.syncAll();
    expect(local.get('a')).toEqual({ updatedAt: 400, syncedAt: 400, tag: 'still mapping it on the pc', diffIds: ['kept-id'] });
  });

  it('restoring a set deleted offline cancels its removal from Drive and uploads it', async () => {
    synced('a', 100);
    local.set('a', { ...local.get('a')!, deletedAt: 300 });
    cloud.offline = true;
    await cloud.remove('a');
    // Restored (storage clears deletedAt and stamps it as a new save), still offline: the upload waits for the sync.
    local.set('a', { updatedAt: 500, syncedAt: 100, tag: 'v1' });
    await cloud.restore(project('a', local.get('a')!));
    cloud.offline = false;
    await cloud.syncAll();
    expect(removed).toEqual([]);
    expect(remote.get('a')).toMatchObject({ updatedAt: 500, tag: 'v1' });
    expect(local.get('a')!.syncedAt).toBe(500);
  });

  it('restoring a set uploads it straight away when Drive is connected', async () => {
    synced('a', 100);
    await cloud.remove('a');
    expect(remote.has('a')).toBe(false);
    local.set('a', { updatedAt: 700, syncedAt: 100, tag: 'v1' });
    await cloud.restore(project('a', local.get('a')!));
    expect(remote.get('a')).toMatchObject({ updatedAt: 700, tag: 'v1' });
  });

  it("doesn't sync while offline", async () => {
    cloud.offline = true;
    expect(cloud.syncing).toBe(false);
    expect(await cloud.syncAll()).toBe(0);
  });

  it('a newer version from Drive keeps the difficulty ids, which scores and collections hang on', async () => {
    synced('a', 100);
    remote.set('a', { ...remote.get('a')!, updatedAt: 300, tag: 'edit on the pc' });
    await cloud.syncAll();
    expect(local.get('a')!.diffIds).toEqual(['kept-id']);
  });

  it('a save made while its set downloads from Drive is not overwritten', async () => {
    synced('a', 100);
    remote.set('a', { ...remote.get('a')!, updatedAt: 300, tag: 'edit on the pc' });
    duringDownload = () => local.set('a', { updatedAt: 200, syncedAt: 100, tag: 'saved here during the sync' });
    await cloud.syncAll();
    expect(local.get('a')!.tag).toBe('saved here during the sync');
  });

  it('a set deleted while it downloads from Drive stays deleted', async () => {
    synced('a', 100);
    remote.set('a', { ...remote.get('a')!, updatedAt: 300, tag: 'edit on the pc' });
    duringDownload = () => (local.get('a')!.deletedAt = 150);
    await cloud.syncAll();
    expect(local.get('a')!.deletedAt).toBe(150);
    expect(local.get('a')!.tag).toBe('v1');
  });
});

describe('downloading a set from the mirrors', () => {
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

  beforeEach(() => {
    cloud.offline = false;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('takes as long as it needs while the data keeps coming', async () => {
    let sent = 0;
    const fetchMock = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start: (ctrl) => ctrl.enqueue(ZIP),
          pull: (ctrl) =>
            new Promise<void>((resolve) =>
              setTimeout(() => {
                if (++sent > 10) ctrl.close();
                else ctrl.enqueue(new Uint8Array([1]));
                resolve();
              }, 50_000),
            ),
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const data = cloud.fetchBeatmapset(1);
    await vi.advanceTimersByTimeAsync(600_000);
    expect((await data).byteLength).toBe(ZIP.length + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('moves on to the next mirror when one stops sending', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async (_url: string, init: RequestInit) =>
          new Response(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(ZIP);
                init.signal!.addEventListener('abort', () => ctrl.error(new Error('aborted')));
              },
            }),
          ),
      )
      .mockImplementationOnce(async () => new Response(ZIP));
    vi.stubGlobal('fetch', fetchMock);
    const data = cloud.fetchBeatmapset(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await data).byteLength).toBe(ZIP.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
