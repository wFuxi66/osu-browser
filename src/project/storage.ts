// Local persistence of projects in IndexedDB, so WIP maps survive reloads without an account.
import { beatmapInfo, type BeatmapInfo } from '../osu/info';
import { parseOsu } from '../osu/parser';
import { STAR_RATING_VERSION, starRating } from '../osu/stars';
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
  difficulties: StoredDifficulty[];
  /** Last time this project was successfully uploaded to the cloud (0 = never). */
  syncedAt: number;
}

interface StoredDifficulty {
  id: string;
  osu: string;
  /** Star rating cached at save time, so song select doesn't recalculate every map on each visit. */
  stars?: { version: string; value: number | null };
}

/** The cached star rating, or a fresh one (with whether it had to be calculated). */
function storedStars(d: StoredDifficulty, bm: ReturnType<typeof parseOsu>): { value: number | null; fresh: boolean } {
  if (d.stars?.version === STAR_RATING_VERSION) return { value: d.stars.value, fresh: false };
  return { value: starRating(bm), fresh: true };
}

export interface DifficultySummary extends BeatmapInfo {
  id: string;
}

export interface ProjectSummary {
  id: string;
  /** "Artist - Title" */
  title: string;
  artist: string;
  songTitle: string;
  artistUnicode: string;
  titleUnicode: string;
  creator: string;
  source: string;
  tags: string;
  beatmapSetId: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number;
  difficulties: DifficultySummary[];
  background: Blob | null;
  audio: Blob | null;
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
    difficulties: p.difficulties.map((d) => {
      const osu = serializeBeatmap(d.beatmap);
      const prev = existing?.difficulties.find((e) => e.id === d.id && e.osu === osu);
      return { id: d.id, osu, stars: { version: STAR_RATING_VERSION, value: storedStars(prev ?? { id: d.id, osu }, parseOsu(osu)).value } };
    }),
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

const summaryCache = new Map<string, { updatedAt: number; summary: ProjectSummary }>();

function summarize(r: StoredProject, backfill: StoredProject[]): ProjectSummary {
  const cached = summaryCache.get(r.id);
  if (cached && cached.updatedAt === r.updatedAt) return { ...cached.summary, syncedAt: r.syncedAt };
  let fresh = false;
  const maps = r.difficulties.map((d) => {
    const bm = parseOsu(d.osu);
    const stars = storedStars(d, bm);
    if (stars.fresh) {
      fresh = true;
      d.stars = { version: STAR_RATING_VERSION, value: stars.value };
    }
    return { id: d.id, bm, stars: stars.value };
  });
  if (fresh) backfill.push(r);
  const order = (m: (typeof maps)[number]) => m.stars ?? m.bm.difficulty.overallDifficulty;
  maps.sort((a, b) => a.bm.general.mode - b.bm.general.mode || order(a) - order(b));
  const m = maps[0]?.bm.metadata;
  const findBlob = (name: string | undefined) => {
    if (!name) return null;
    const lower = name.toLowerCase().replace(/\\/g, '/');
    return r.files.find((f) => f.name.toLowerCase().replace(/\\/g, '/') === lower)?.blob ?? null;
  };
  const first = maps[0]?.bm;
  const summary: ProjectSummary = {
    id: r.id,
    title: r.title,
    artist: m?.artist || m?.artistUnicode || '',
    songTitle: m?.title || m?.titleUnicode || '',
    artistUnicode: m?.artistUnicode || m?.artist || '',
    titleUnicode: m?.titleUnicode || m?.title || '',
    creator: m?.creator ?? '',
    source: m?.source ?? '',
    tags: m?.tags ?? '',
    beatmapSetId: m?.beatmapSetId ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    syncedAt: r.syncedAt,
    difficulties: maps.map(({ id, bm, stars }) => ({ id, ...beatmapInfo(bm, stars) })),
    background: findBlob(maps.find((x) => x.bm.events.background)?.bm.events.background?.filename),
    audio: findBlob(first?.general.audioFilename),
  };
  summaryCache.set(r.id, { updatedAt: r.updatedAt, summary });
  return summary;
}

export async function listProjectsLocal(): Promise<ProjectSummary[]> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  const backfill: StoredProject[] = [];
  const list = all.map((r) => summarize(r, backfill)).sort((a, b) => b.updatedAt - a.updatedAt);
  if (backfill.length) void backfillStars(backfill).catch(() => {});
  return list;
}

/** Stores star ratings calculated for projects saved before they were cached (or by an older calculator). */
async function backfillStars(records: StoredProject[]): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const r of records) {
      const req = store.get(r.id);
      req.onsuccess = () => {
        const current = req.result as StoredProject | undefined;
        // Skip projects saved again in the meantime.
        if (current && current.updatedAt === r.updatedAt) store.put({ ...current, difficulties: r.difficulties });
      };
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Remove one difficulty from a stored set. Returns the updated project, or null if it was the last one. */
export async function deleteDifficultyLocal(projectId: string, diffId: string): Promise<Project | null> {
  const p = await loadProjectLocal(projectId);
  if (!p || p.difficulties.length <= 1) return null;
  p.difficulties = p.difficulties.filter((d) => d.id !== diffId);
  p.updatedAt = Date.now();
  await saveProjectLocal(p);
  return p;
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
  backgroundDim: 0.5,
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
