// Local persistence of projects in IndexedDB, so WIP maps survive reloads without an account.
import { beatmapInfo, type BeatmapInfo } from '../osu/info';
import { parseOsu } from '../osu/parser';
import { STAR_RATING_VERSION, starRating } from '../osu/stars';
import { serializeBeatmap } from '../osu/serializer';
import { parseOsb, parseStoryboardLines, referencedFiles } from '../osu/storyboard';
import { checksumOf, findFile, projectTitle, uid, uniqueVersionName, type DifficultySource, type Project, type ProjectOrigin } from './project';
import type { Keybinds } from '../editor/keybinds';

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
  origin?: ProjectOrigin;
  /** When it was deleted: it waits in Recently deleted until it's restored or cleaned up (see TRASH_DAYS). */
  deletedAt?: number;
  /** A difficulty deleted on its own: the set it restores into. Its record holds that difficulty and the files only it used. */
  trashOf?: string;
}

interface StoredDifficulty {
  id: string;
  osu: string;
  source?: DifficultySource;
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
  beatmapId: number;
  /** osu!'s checksum for the difficulty as it is now (see checksumOf). */
  checksum: string;
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

function recordOf(p: Project, existing: StoredProject | undefined, syncedAt?: number): StoredProject {
  return {
    id: p.id,
    title: projectTitle(p),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    files: [...p.files].map(([name, blob]) => ({ name, blob })),
    difficulties: p.difficulties.map((d) => {
      const osu = serializeBeatmap(d.beatmap);
      const prev = existing?.difficulties.find((e) => e.id === d.id && e.osu === osu);
      return { id: d.id, osu, source: d.source, stars: { version: STAR_RATING_VERSION, value: storedStars(prev ?? { id: d.id, osu }, parseOsu(osu)).value } };
    }),
    syncedAt: syncedAt ?? existing?.syncedAt ?? 0,
    origin: p.origin ?? existing?.origin,
  };
}

function getRecord(id: string): Promise<StoredProject | undefined> {
  return tx<StoredProject | undefined>('readonly', (s) => s.get(id));
}

/** Puts and deletes records in one transaction, so a crash can't leave half of a change. */
function write(puts: StoredProject[], deletes: string[] = []): Promise<void> {
  return db().then(
    (d) =>
      new Promise<void>((resolve, reject) => {
        const t = d.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        for (const r of puts) store.put(r);
        for (const id of deletes) store.delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

/** Saves a project. Saving a deleted one (a newer version from Drive, say) takes it out of Recently deleted. */
export async function saveProjectLocal(p: Project, syncedAt?: number): Promise<void> {
  await freeSpaceIfShort().catch(() => undefined);
  const existing = await getRecord(p.id);
  await tx('readwrite', (s) => s.put(recordOf(p, existing, syncedAt)));
}

export async function markSynced(id: string, syncedAt: number): Promise<void> {
  const existing = await tx<StoredProject | undefined>('readonly', (s) => s.get(id));
  if (!existing) return;
  existing.syncedAt = syncedAt;
  await tx('readwrite', (s) => s.put(existing));
}

/** The updatedAt of the version this browser and Drive last both had (0 = never synced). */
export async function syncedAtLocal(id: string): Promise<number> {
  const r = await tx<StoredProject | undefined>('readonly', (s) => s.get(id));
  return r?.syncedAt ?? 0;
}

/** Records what the mirrors serve for a project's set, without counting as a save. */
export async function saveOriginLocal(id: string, origin: ProjectOrigin): Promise<void> {
  const existing = await tx<StoredProject | undefined>('readonly', (s) => s.get(id));
  if (!existing) return;
  existing.origin = origin;
  await tx('readwrite', (s) => s.put(existing));
}

function toProject(r: StoredProject): Project {
  return {
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    files: new Map(r.files.map((f) => [f.name, f.blob])),
    difficulties: r.difficulties.map((d) => ({ id: d.id, beatmap: parseOsu(d.osu), source: d.source })),
    origin: r.origin,
  };
}

/** A stored project, or null when there's none (or it's in Recently deleted). */
export async function loadProjectLocal(id: string): Promise<Project | null> {
  const r = await getRecord(id);
  return r && !r.deletedAt ? toProject(r) : null;
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
    return { id: d.id, bm, stars: stars.value, checksum: checksumOf(d.osu, d.source) };
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
    difficulties: maps.map(({ id, bm, stars, checksum }) => ({ id, beatmapId: bm.metadata.beatmapId, checksum, ...beatmapInfo(bm, stars) })),
    background: findBlob(maps.find((x) => x.bm.events.background)?.bm.events.background?.filename),
    audio: findBlob(first?.general.audioFilename),
  };
  summaryCache.set(r.id, { updatedAt: r.updatedAt, summary });
  return summary;
}

export async function listProjectsLocal(): Promise<ProjectSummary[]> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  const backfill: StoredProject[] = [];
  const list = all.filter((r) => !r.deletedAt).map((r) => summarize(r, backfill)).sort((a, b) => b.updatedAt - a.updatedAt);
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

/** Deletes a set for good (Recently deleted's "Delete forever"; a delete in song select goes to trashProjectLocal). */
export async function deleteProjectLocal(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

// ------------------------------------------------------------------ Recently deleted
// Like stable sending deleted maps to the Recycle Bin: a deleted set keeps its record, marked with deletedAt, and a
// difficulty deleted on its own gets a record of its own. Both stay in the 'projects' store (a new store would need
// a database upgrade, which a tab still on the old version would block). An older version of the app sees them as
// ordinary sets; a difficulty's record is stamped as synced so that it doesn't upload it.

/** Days a deleted map can be restored. */
export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
/** Share of the browser's storage quota above which the oldest deleted maps go early, before the browser runs short. */
export const TRASH_PRESSURE = 0.8;

export interface TrashEntry {
  id: string;
  /** The set it belongs to (its own id for a whole set). */
  setId: string;
  /** "Artist - Title" */
  title: string;
  /** The difficulty's name, or null for a whole set. */
  version: string | null;
  deletedAt: number;
  /** The version Drive last had, for sync. */
  syncedAt: number;
  /** Bytes it takes up. */
  size: number;
}

const trashId = (diffId: string) => `deleted-difficulty:${diffId}`;
const fileKey = (name: string) => name.toLowerCase().replace(/\\/g, '/');

/** Files a difficulty names: its song, background, video, storyboard images and sounds, and custom hitsounds. */
function filesNamedBy(osu: string): string[] {
  const bm = parseOsu(osu);
  return [
    bm.general.audioFilename,
    bm.events.background?.filename,
    bm.events.video?.filename,
    ...referencedFiles(parseStoryboardLines(bm.events.storyboardLines).elements),
    ...bm.hitObjects.map((o) => o.sample.filename),
  ].filter((f): f is string => !!f);
}

/**
 * The set's files that only `d` names, which leave the set with it. Anything the set's other difficulties or its
 * .osb use stays, and so do files no difficulty names (skin elements, default hitsounds).
 */
async function filesOnlyUsedBy(d: StoredDifficulty, others: StoredDifficulty[], files: StoredProject['files']): Promise<Set<string>> {
  const shared = new Set(others.flatMap((o) => filesNamedBy(o.osu)).map(fileKey));
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.osb')) continue;
    shared.add(fileKey(f.name));
    try {
      for (const name of referencedFiles(parseOsb(await f.blob.text()).elements)) shared.add(fileKey(name));
    } catch {
      // unreadable storyboard: it keeps nothing
    }
  }
  const own = new Set(filesNamedBy(d.osu).map(fileKey).filter((k) => !shared.has(k)));
  return new Set(files.filter((f) => own.has(fileKey(f.name))).map((f) => f.name));
}

function sizeOf(r: StoredProject): number {
  return r.files.reduce((n, f) => n + f.blob.size, 0) + r.difficulties.reduce((n, d) => n + d.osu.length, 0);
}

/** Sends a set to Recently deleted. */
export async function trashProjectLocal(id: string): Promise<void> {
  const r = await getRecord(id);
  if (r && !r.deletedAt) await write([{ ...r, deletedAt: Date.now() }]);
}

/**
 * Sends one difficulty of a set to Recently deleted, with the files only it used. Returns the set as it is now, or
 * null if that was its last difficulty (the whole set is deleted then).
 */
export async function trashDifficultyLocal(projectId: string, diffId: string): Promise<Project | null> {
  const r = await getRecord(projectId);
  const d = r?.difficulties.find((x) => x.id === diffId);
  if (!r || r.deletedAt || !d || r.difficulties.length <= 1) return null;
  const rest = r.difficulties.filter((x) => x !== d);
  const own = await filesOnlyUsedBy(d, rest, r.files);
  const now = Date.now();
  const set: StoredProject = { ...r, updatedAt: now, difficulties: rest, files: r.files.filter((f) => !own.has(f.name)) };
  const p = toProject(set);
  set.title = projectTitle(p);
  const entry: StoredProject = {
    id: trashId(d.id),
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: now,
    syncedAt: now,
    files: r.files.filter((f) => own.has(f.name)),
    difficulties: [d],
    deletedAt: now,
    trashOf: r.id,
  };
  await write([set, entry]);
  return p;
}

/** What's in Recently deleted, most recently deleted first. */
export async function listTrashLocal(): Promise<TrashEntry[]> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  return all
    .filter((r) => r.deletedAt)
    .map((r) => ({
      id: r.id,
      setId: r.trashOf ?? r.id,
      title: r.title,
      version: r.trashOf ? (r.difficulties[0] ? parseOsu(r.difficulties[0].osu).metadata.version : '') : null,
      deletedAt: r.deletedAt!,
      syncedAt: r.syncedAt,
      size: sizeOf(r),
    }))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * Takes a set or difficulty out of Recently deleted. It counts as a new save, so the next sync uploads it. A
 * difficulty goes back into its set, restoring the set too if that was deleted. Returns the set as it is now.
 */
export async function restoreTrashLocal(id: string): Promise<Project | null> {
  const r = await getRecord(id);
  if (!r?.deletedAt) return null;
  const now = Date.now();
  if (!r.trashOf) {
    const { deletedAt: _, ...live } = r;
    const restored = { ...live, updatedAt: now };
    await write([restored]);
    return toProject(restored);
  }
  const set = await getRecord(r.trashOf);
  const entry = toProject(r);
  // Its set was deleted for good some other way: the difficulty makes a set on its own again.
  const p: Project = set ? toProject(set) : { ...entry, id: r.trashOf, files: new Map(), difficulties: [] };
  for (const d of entry.difficulties) {
    if (p.difficulties.some((x) => x.id === d.id)) d.id = uid();
    d.beatmap.metadata.version = uniqueVersionName(p, d.beatmap.metadata.version);
    p.difficulties.push(d);
  }
  for (const [name, blob] of entry.files) if (!findFile(p, name)) p.files.set(name, blob);
  p.updatedAt = now;
  await write([recordOf(p, set)], [id]);
  return p;
}

/** Removes entries from Recently deleted for good. A set takes its difficulties' entries along (they can't go back without it). */
export async function deleteTrashLocal(ids: string[]): Promise<void> {
  const all = await tx<StoredProject[]>('readonly', (s) => s.getAll());
  const gone = new Set(ids.filter((id) => all.some((r) => r.id === id && r.deletedAt)));
  for (const r of all) if (r.deletedAt && r.trashOf && gone.has(r.trashOf)) gone.add(r.id);
  if (gone.size) await write([], [...gone]);
}

/**
 * The entries to remove: those deleted more than TRASH_DAYS ago, then, while `usage` is above TRASH_PRESSURE of
 * `quota`, the oldest of the rest.
 */
export function trashToRemove(entries: Pick<TrashEntry, 'id' | 'deletedAt' | 'size'>[], now: number, usage = 0, quota = 0): string[] {
  const out: string[] = [];
  let used = usage;
  for (const e of [...entries].sort((a, b) => a.deletedAt - b.deletedAt)) {
    if (now - e.deletedAt > TRASH_DAYS * DAY || (quota > 0 && used > quota * TRASH_PRESSURE)) {
      out.push(e.id);
      used -= e.size;
    }
  }
  return out;
}

async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const e = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
  return e?.quota ? { usage: e.usage ?? 0, quota: e.quota } : null;
}

/**
 * Removes what was deleted more than TRASH_DAYS ago and, when the site is using most of its storage, the oldest of
 * the rest: a browser short of space can clear all of a site's data, and old deleted maps mustn't be the cause.
 */
export async function cleanUpTrash(now = Date.now()): Promise<void> {
  const entries = await listTrashLocal();
  if (!entries.length) return;
  const e = await storageEstimate();
  const ids = trashToRemove(entries, now, e?.usage, e?.quota);
  if (ids.length) await deleteTrashLocal(ids);
}

let spaceCheckedAt = 0;

/** Before a save: makes room from Recently deleted if storage is filling up (checked at most once a minute). */
async function freeSpaceIfShort(): Promise<void> {
  if (Date.now() - spaceCheckedAt < 60_000) return;
  spaceCheckedAt = Date.now();
  const e = await storageEstimate();
  if (e && e.usage > e.quota * TRASH_PRESSURE) await cleanUpTrash();
}

const PREFS_KEY = 'osu-web-editor:prefs';

export interface Prefs {
  masterVolume: number;
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
  /** Skin id: 'default' (osu!default), 'drawn', or an imported skin's id. */
  skin: string;
  /** Draw hit circles with the beatmap's own skin files (hitcircle.png etc. in the set) over the chosen skin. */
  beatmapSkins: boolean;
  /** Map with osu!default whatever skin is chosen, as stable's editor can. */
  editorDefaultSkin: boolean;
  /** Show the playfield grid (whether or not grid snap is on). */
  showGrid: boolean;
  gridSnap: boolean;
  distanceSnap: boolean;
  /** Draw the timeline's circles with the skin, like stable (otherwise flat discs). */
  skinnedTimeline: boolean;
  /** osu!direct and My beatmaps download sets with their video. */
  downloadVideo: boolean;
  /** Key binding changes from the defaults (see editor/keybinds.ts). */
  keybinds: Keybinds;
  /** Move the playhead on after placing an object (circle → next tick, slider/spinner → end), like stable. */
  autoAdvance: boolean;
  /** Touch editor: beat-snap ticks to move forward after placing (0 = off, overrides autoAdvance on touch). */
  touchAutoAdvance: number;

  // Gameplay (play mode and the editor's test mode), as in stable's Options.
  /** Background dim while playing (the editor has its own). */
  playDim: number;
  /** "Don't change dim level during breaks". */
  keepDimInBreaks: boolean;
  showLeaderboard: boolean;
  progressDisplay: 'topright' | 'bottomright' | 'bottom' | 'none';
  scoreMeter: 'none' | 'colour' | 'error';
  scoreMeterSize: number;
  /** "Always show key overlay" (it shows during autoplay anyway). */
  keyOverlay: boolean;
  /** "Show approach circle on first "Hidden" object". */
  hiddenFirstApproach: boolean;
  playSnaking: boolean;
  playStoryboard: boolean;
  playVideo: boolean;
  showFps: boolean;
  ignoreBeatmapHitsounds: boolean;
  cursorSize: number;
  /** Scale the cursor with the beatmap's circle size. */
  autoCursorSize: boolean;
  /** "Disable mouse wheel in play mode": otherwise the wheel changes the volume while playing, like stable. */
  disableWheelInPlay: boolean;
  /** "Disable mouse buttons in play mode": only the keys hit. */
  disableMouseButtons: boolean;
  // Main menu and song select
  menuParallax: boolean;
  menuTips: boolean;
  showThumbnails: boolean;
  /** Sync these settings through Google Drive when it's connected. */
  syncSettings: boolean;
  /** When the settings last changed (ms), for newest-wins sync. */
  updatedAt: number;
}

export const DEFAULT_PREFS: Prefs = {
  masterVolume: 1,
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
  skin: 'default',
  showGrid: true,
  gridSnap: true,
  distanceSnap: false,
  beatmapSkins: false,
  editorDefaultSkin: true,
  skinnedTimeline: true,
  downloadVideo: true,
  autoAdvance: true,
  touchAutoAdvance: 1,
  keybinds: {},
  playDim: 0.8,
  keepDimInBreaks: false,
  showLeaderboard: true,
  progressDisplay: 'topright',
  scoreMeter: 'error',
  scoreMeterSize: 1,
  keyOverlay: false,
  hiddenFirstApproach: true,
  playSnaking: true,
  playStoryboard: true,
  playVideo: true,
  showFps: false,
  ignoreBeatmapHitsounds: false,
  cursorSize: 1,
  autoCursorSize: false,
  disableWheelInPlay: false,
  disableMouseButtons: false,
  menuParallax: true,
  menuTips: true,
  showThumbnails: true,
  syncSettings: true,
  updatedAt: 0,
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
