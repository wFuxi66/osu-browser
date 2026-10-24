// Client for the optional backend: osu! OAuth login, and cloud sync of beatmaps to the user's own Google Drive
// (drive.ts). Published sets are synced as lite packages (see syncpack.ts) and rebuilt from the mirrors.
import { drive, type DriveProject } from './drive';
import { importOsz, oszFilename, type Project } from './project';
import { listProjectsLocal, loadProjectLocal, markSynced, saveOriginLocal, saveProjectLocal } from './storage';
import { buildSyncPackage, originOf, restoreSyncPackage, setIdOf } from './syncpack';

/** How long to wait before asking the mirrors again for a set they didn't have. */
const MIRROR_RECHECK = 1000 * 60 * 60 * 24;

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

  async upload(p: Project): Promise<void> {
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
          ? 'Only the edited files of this published beatmap set. Beatmap Web Editor downloads the rest from osu! mirrors when it opens it.'
          : 'Beatmap package, synced by Beatmap Web Editor. Opens in osu!.',
      },
      blob,
    );
    await markSynced(p.id, p.updatedAt);
  }

  async download(meta: CloudProject): Promise<{ project: Project; warnings: string[] }> {
    const data = await drive.download(meta.fileId);
    const { project: p, warnings } = await restoreSyncPackage(data, (setId) => this.fetchBeatmapset(setId));
    p.id = meta.id;
    p.updatedAt = meta.updatedAt;
    p.createdAt = meta.createdAt;
    return { project: p, warnings };
  }

  remove(id: string): Promise<void> {
    return drive.remove(id);
  }

  /** Two-way sync, newest wins. Returns the number of projects transferred. */
  async syncAll(): Promise<number> {
    if (!this.syncing) return 0;
    const [remote, local] = await Promise.all([this.list(), listProjectsLocal()]);
    const localById = new Map(local.map((l) => [l.id, l]));
    const remoteById = new Map(remote.map((r) => [r.id, r]));
    let n = 0;
    // One map failing (e.g. its set left the mirrors) shouldn't stop the others from syncing.
    const failures: string[] = [];
    for (const r of remote) {
      const l = localById.get(r.id);
      if (!l || r.updatedAt > l.updatedAt) {
        try {
          const { project, warnings } = await this.download(r);
          await saveProjectLocal(project, r.updatedAt);
          n++;
          for (const w of warnings) failures.push(`"${r.title}": ${w}`);
        } catch (e) {
          failures.push(`"${r.title}": ${(e as Error).message}`);
        }
      }
    }
    for (const l of local) {
      const r = remoteById.get(l.id);
      if ((!r || l.updatedAt > r.updatedAt) && l.updatedAt > l.syncedAt) {
        try {
          const p = await loadProjectLocal(l.id);
          if (p) {
            await this.upload(p);
            n++;
          }
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
    }
    if (failures.length) throw new Error((n > 0 ? `Synced ${n}, but ` : '') + failures.join(' · '));
    return n;
  }

  /**
   * Fetch a published beatmapset (.osz) by id. Downloads straight from public mirrors that allow CORS,
   * then falls back to the standalone server's mirror proxy (not available on the Vercel deployment).
   */
  async fetchBeatmapset(setId: number, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
    for (const url of [...BROWSER_MIRRORS.map((m) => m(setId)), `/api/mirror/${setId}`]) {
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
const BROWSER_MIRRORS = [(id: number) => `https://osu.direct/api/d/${id}`, (id: number) => `https://api.nerinyan.moe/d/${id}`];

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
