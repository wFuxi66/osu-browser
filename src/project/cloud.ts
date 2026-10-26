// Client for the optional backend: osu! OAuth login, and cloud sync of beatmaps to the user's own Google Drive
// (drive.ts). Published sets are synced as lite packages (see syncpack.ts) and rebuilt from the mirrors.
import { drive, type DriveProject } from './drive';
import { importOsz, oszFilename, type Project } from './project';
import { listProjectsLocal, loadProjectLocal, markSynced, saveOriginLocal, saveProjectLocal, type Prefs } from './storage';
import { buildSyncPackage, originOf, restoreSyncPackage, setIdOf } from './syncpack';

/** How long to wait before asking the mirrors again for a set they didn't have. */
const MIRROR_RECHECK = 1000 * 60 * 60 * 24;
/** Maps transferred at once by a full sync: enough to hide each request's latency, few enough for memory. */
const SYNC_CONCURRENCY = 3;

/** Runs `fn` over the items, at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export interface OsuUser {
  id: number;
  username: string;
  avatarUrl: string;
  countryCode: string;
}

export type CloudProject = DriveProject;

class Cloud {
  user: OsuUser | null = null;
  /** False when no backend is reachable (e.g. static hosting); login and sync UI is hidden then. */
  available = false;
  oauthConfigured = false;
  driveConfigured = false;
  driveConnected = false;
  /** How the last Google Drive sign-in went (from the redirect back), for song select to report once. */
  driveResult: string | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    drive.onDisconnected = () => {
      this.driveConnected = false;
      this.emit();
    };
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Whether saves sync to the cloud. */
  get syncing(): boolean {
    return this.driveConnected;
  }

  async init() {
    const params = new URLSearchParams(location.search);
    if (params.has('drive')) {
      this.driveResult = params.get('drive');
      params.delete('drive');
      history.replaceState(history.state, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
    }
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (!r.headers.get('content-type')?.includes('json')) throw new Error('no backend');
      const data = await r.json();
      this.available = true;
      this.oauthConfigured = !!data.oauthConfigured;
      this.driveConfigured = !!data.driveConfigured;
      this.driveConnected = !!data.driveConnected;
      this.user = data.user ?? null;
    } catch {
      this.available = false;
      this.user = null;
      this.driveConnected = false;
    }
    this.emit();
  }

  private returnPath() {
    return encodeURIComponent(location.pathname + location.search);
  }

  login() {
    location.href = `/api/auth/login?return=${this.returnPath()}`;
  }

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    this.user = null;
    this.emit();
  }

  /** Sends the user to Google to allow access to the app's own files in their Drive. */
  connectDrive() {
    location.href = `/api/drive/login?return=${this.returnPath()}`;
  }

  /** Stops syncing in this browser. Maps already in Drive stay there. */
  async disconnectDrive() {
    await drive.disconnect();
    this.driveConnected = false;
    this.emit();
  }

  list(): Promise<CloudProject[]> {
    return drive.list();
  }

  /**
   * Makes sure a published set knows what the mirrors serve for it, so its upload can leave those files out.
   * Sets downloaded in the app know already; others (local .osz/folders) fetch the set from a mirror once.
   */
  private async ensureOrigin(p: Project): Promise<void> {
    const setId = setIdOf(p);
    if (!(setId > 0)) return;
    const o = p.origin;
    if (o?.setId === setId && (o.files || Date.now() - o.checkedAt < MIRROR_RECHECK)) return;
    try {
      const mirror = await importOsz(await this.fetchBeatmapset(setId));
      p.origin = await originOf(setId, mirror.files);
    } catch {
      // Not on the mirrors (unsubmitted, or they're down): upload the whole set for now.
      p.origin = { setId, files: null, checkedAt: Date.now() };
    }
    await saveOriginLocal(p.id, p.origin);
  }

  /** Each project's upload in flight (later saves wait for it), and the last updatedAt sent. */
  private uploads = new Map<string, Promise<void>>();
  private uploaded = new Map<string, number>();

  /**
   * Uploads a project. Saves made while one of its uploads is running wait for it and then send only the newest
   * state once, rather than racing each other.
   */
  upload(p: Project): Promise<void> {
    const prev = this.uploads.get(p.id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => (p.updatedAt > (this.uploaded.get(p.id) ?? 0) ? this.uploadNow(p) : undefined));
    this.uploads.set(p.id, next);
    const done = () => {
      if (this.uploads.get(p.id) === next) this.uploads.delete(p.id);
    };
    next.then(done, done);
    return next;
  }

  private async uploadNow(p: Project): Promise<void> {
    const at = p.updatedAt;
    await this.ensureOrigin(p);
    const { blob, lite } = await buildSyncPackage(p);
    const osz = oszFilename(p);
    await drive.upload(
      {
        id: p.id,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        fileName: lite ? osz.replace(/.osz$/i, ' (edited files only).zip') : osz,
        description: lite
          ? 'Only the edited files of this published beatmap set. osu!browser downloads the rest from osu! mirrors when it opens it.'
          : 'Beatmap package, synced by osu!browser. Opens in osu!.',
      },
      blob,
    );
    await markSynced(p.id, at);
    this.uploaded.set(p.id, at);
  }

  async download(meta: CloudProject): Promise<{ project: Project; warnings: string[] }> {
    const data = await drive.download(meta.fileId);
    const { project: p, warnings } = await restoreSyncPackage(data, (setId) => this.fetchBeatmapset(setId));
    p.id = meta.id;
    p.updatedAt = meta.updatedAt;
    p.createdAt = meta.createdAt;
    return { project: p, warnings };
  }

  /**
   * Newest-wins sync of the settings file in Drive. Returns the settings to apply when Drive's copy is newer;
   * uploads ours when it is newer.
   */
  async syncSettings(local: Prefs): Promise<Partial<Prefs> | null> {
    if (!this.syncing || !local.syncSettings) return null;
    const remote = await drive.getSettings();
    if (remote && remote.updatedAt > local.updatedAt && remote.data && typeof remote.data === 'object') {
      return { ...syncedPrefs(remote.data as Prefs), updatedAt: remote.updatedAt };
    }
    if (remote ? local.updatedAt > remote.updatedAt : local.updatedAt > 0) await drive.putSettings(syncedPrefs(local), local.updatedAt);
    return null;
  }

  remove(id: string): Promise<void> {
    return drive.remove(id);
  }

  private running: Promise<number> | null = null;

  /**
   * Two-way sync, newest wins, a few maps at a time. `onProgress` hears how many of the transfers are done (and
   * after each one, so the song list can show maps as they arrive). Returns the number of projects transferred.
   * Asked again while it runs, it returns the sync already running.
   */
  syncAll(onProgress?: (done: number, total: number) => void): Promise<number> {
    if (!this.syncing) return Promise.resolve(0);
    this.running ??= this.syncAllNow(onProgress).finally(() => (this.running = null));
    return this.running;
  }

  private async syncAllNow(onProgress?: (done: number, total: number) => void): Promise<number> {
    const [remote, local] = await Promise.all([this.list(), listProjectsLocal()]);
    const localById = new Map(local.map((l) => [l.id, l]));
    const remoteById = new Map(remote.map((r) => [r.id, r]));
    // One map failing (e.g. its set left the mirrors) shouldn't stop the others from syncing.
    const failures: string[] = [];
    const jobs: (() => Promise<void>)[] = [];
    for (const r of remote) {
      const l = localById.get(r.id);
      if (!l || r.updatedAt > l.updatedAt) {
        jobs.push(async () => {
          try {
            const { project, warnings } = await this.download(r);
            await saveProjectLocal(project, r.updatedAt);
            for (const w of warnings) failures.push(`"${r.title}": ${w}`);
          } catch (e) {
            failures.push(`"${r.title}": ${(e as Error).message}`);
          }
        });
      }
    }
    for (const l of local) {
      const r = remoteById.get(l.id);
      if ((!r || l.updatedAt > r.updatedAt) && l.updatedAt > l.syncedAt) {
        jobs.push(async () => {
          try {
            const p = await loadProjectLocal(l.id);
            if (p) await this.upload(p);
          } catch (e) {
            failures.push((e as Error).message);
          }
        });
      }
    }
    let done = 0;
    if (jobs.length) onProgress?.(0, jobs.length);
    await pool(jobs, SYNC_CONCURRENCY, async (job) => {
      await job();
      onProgress?.(++done, jobs.length);
    });
    const n = jobs.length - failures.length;
    if (failures.length) throw new Error((n > 0 ? `Synced ${n}, but ` : '') + failures.join(' · '));
    return n;
  }

  /**
   * Fetch a published beatmapset (.osz) by id. Downloads straight from public mirrors that allow CORS,
   * then falls back to the standalone server's mirror proxy (not available on the Vercel deployment). Without
   * video, osu.direct leaves the set's video out; the fallbacks always include it.
   */
  async fetchBeatmapset(setId: number, onProgress?: (fraction: number) => void, video = true): Promise<ArrayBuffer> {
    for (const url of [...BROWSER_MIRRORS.map((m) => m(setId, video)), `/api/mirror/${setId}`]) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!r.ok) continue;
        const data = await readWithProgress(r, onProgress);
        if (data.byteLength >= 4 && new DataView(data).getUint32(0, true) === 0x04034b50) return data;
      } catch {
        // try the next mirror
      }
    }
    throw new Error('Could not download that beatmapset from any mirror. Check the link, or download the .osz yourself and drop it here.');
  }
}

// Mirrors that send Access-Control-Allow-Origin (checked 2026-10-24; catboy.best doesn't, so it's proxy-only).
const BROWSER_MIRRORS = [
  (id: number, video: boolean) => `https://osu.direct/api/d/${id}${video ? '' : '?noVideo=1'}`,
  (id: number) => `https://api.nerinyan.moe/d/${id}`,
];

/** Reads a response body, reporting progress when the size is known. */
async function readWithProgress(r: Response, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const total = Number(r.headers.get('content-length')) || 0;
  if (!onProgress || !total || !r.body) return r.arrayBuffer();
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (let c = await reader.read(); !c.done; c = await reader.read()) {
    chunks.push(c.value);
    got += c.value.length;
    onProgress(Math.min(1, got / total));
  }
  return new Blob(chunks as BlobPart[]).arrayBuffer();
}

export const cloud = new Cloud();

/** The settings that follow the user between computers: not the audio offset (it depends on the device) or imported skins (they stay in each browser). */
export function syncedPrefs(p: Partial<Prefs>): Partial<Prefs> {
  const { audioOffset: _offset, syncSettings: _sync, updatedAt: _at, skin, ...rest } = p;
  return skin === 'default' || skin === 'drawn' ? { ...rest, skin } : rest;
}
