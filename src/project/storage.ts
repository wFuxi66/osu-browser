// Local persistence of projects in IndexedDB, so WIP maps survive reloads without an account.
import { parseOsu } from '../osu/parser';
import { serializeBeatmap } from '../osu/serializer';
import { projectTitle, type Project } from './project';

const DB_NAME = 'osu-web-editor';
const STORE = 'projects';

interface StoredProject {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  files: { name: string; blob: Blob }[];
  difficulties: { id: string; osu: string }[];
  /** Last time this project was successfully uploaded to the cloud (0 = never). */
  syncedAt: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: number;
  difficulties: string[];
  syncedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveProjectLocal(p: Project, syncedAt?: number): Promise<void> {
  const existing = await tx<StoredProject | undefined>('readonly', (s) => s.get(p.id));
  const record: StoredProject = {
    id: p.id,
    title: projectTitle(p),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    files: [...p.files].map(([name, blob]) => ({ name, blob })),
    difficulties: p.difficulties.map((d) => ({ id: d.id, osu: serializeBeatmap(d.beatmap) })),
    syncedAt: syncedAt ?? existing?.syncedAt ?? 0,
  };
  await tx('readwrite', (s) => s.put(record));
}

export async function markSynced(id: string, syncedAt: number): Promise<void> {
  const existing = await tx<StoredProject | undefined>('readonly', (s) => s.get(id));
  if (!existing) return;
  existing.syncedAt = syncedAt;
  await tx('readwrite', (s) => s.put(existing));
}

export async function loadProjectLocal(id: string): Promise<Project | null> {
  const r = await tx<StoredProject | undefined>('readonly', (s) => s.get(id));
  if (!r) return null;
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    files: new Map(r.files.map((f) => [f.name, f.blob])),
    difficulties: r.difficulties.map((d) => ({ id: d.id, beatmap: parseOsu(d.osu) })),
  };
}

export async function listProjectsLocal(): Promise<ProjectSummary[]> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  return all
    .map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updatedAt,
      syncedAt: r.syncedAt,
      difficulties: r.difficulties.map((d) => /^Version:(.*)$/m.exec(d.osu)?.[1]?.trim() ?? '?'),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProjectLocal(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

const PREFS_KEY = 'osu-web-editor:prefs';

export interface Prefs {
  musicVolume: number;
  hitsoundVolume: number;
  audioOffset: number;
  showHitAnimations: boolean;
  showFollowPoints: boolean;
  snakingSliders: boolean;
  backgroundDim: number;
  showWaveform: boolean;
  showStoryboard: boolean;
  showVideo: boolean;
  creatorName: string;
  invertScroll: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  musicVolume: 0.6,
  hitsoundVolume: 0.8,
  audioOffset: 0,
  showHitAnimations: true,
  showFollowPoints: true,
  snakingSliders: true,
  backgroundDim: 0.7,
  showWaveform: false,
  showStoryboard: true,
  showVideo: true,
  creatorName: '',
  invertScroll: false,
};

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
