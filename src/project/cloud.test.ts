import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriveProject } from './drive';
import type { Project } from './project';

// An in-memory Drive and browser store: what each side holds, by project id.
interface Local {
  updatedAt: number;
  syncedAt: number;
  tag: string;
}
const remote = new Map<string, DriveProject & { tag: string }>();
const local = new Map<string, Local>();
const removed: string[] = [];

const project = (id: string, l: { updatedAt: number; tag: string }): Project =>
  ({ id, createdAt: 1, updatedAt: l.updatedAt, files: new Map([['tag', new Blob([l.tag])]]), difficulties: [] }) as unknown as Project;
const tagOf = async (p: Project) => (await p.files.get('tag')?.text()) ?? '';

vi.mock('./drive', () => ({
  drive: {
    list: async () => [...remote.values()],
    get: async (id: string) => remote.get(id) ?? null,
    upload: async (meta: { id: string; updatedAt: number }, blob: Blob) => {
      remote.set(meta.id, { fileId: `f-${meta.id}`, id: meta.id, title: meta.id, createdAt: 1, updatedAt: meta.updatedAt, size: 0, tag: await blob.text() });
    },
    download: async (fileId: string) => [...remote.values()].find((r) => r.fileId === fileId)!.tag,
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
  restoreSyncPackage: async (tag: string) => ({ project: project('', { updatedAt: 0, tag }), warnings: [] }),
}));
vi.mock('./storage', () => ({
  listProjectsLocal: async () => [...local].map(([id, l]) => ({ id, ...l })),
  loadProjectLocal: async (id: string) => (local.has(id) ? project(id, local.get(id)!) : null),
  saveProjectLocal: async (p: Project, syncedAt?: number) => {
    local.set(p.id, { updatedAt: p.updatedAt, syncedAt: syncedAt ?? local.get(p.id)?.syncedAt ?? 0, tag: await tagOf(p) });
  },
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
    await cloud.upload(project('d', local.get('d')!));
    expect(remote.get('d')!.tag).toBe('edit here');
    expect(tags()).toEqual(['edit here', 'edit on the pc']);
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

  it("doesn't sync while offline", async () => {
    cloud.offline = true;
    expect(cloud.syncing).toBe(false);
    expect(await cloud.syncAll()).toBe(0);
  });
});
