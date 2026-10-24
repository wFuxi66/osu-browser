// Client for the optional backend: osu! OAuth login and per-account project sync. Packages go straight
// between the browser and Supabase Storage via signed URLs from the API; only small JSON passes through it.
import { exportOsz, importOsz, projectTitle, type Project } from './project';
import { listProjectsLocal, loadProjectLocal, markSynced, saveProjectLocal } from './storage';

export interface OsuUser {
  id: number;
  username: string;
  avatarUrl: string;
  countryCode: string;
}

export interface CloudProject {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  size: number;
}

class Cloud {
  user: OsuUser | null = null;
  /** False when no backend is reachable (e.g. static hosting); login UI is hidden then. */
  available = false;
  oauthConfigured = false;
  /** Largest .osz the server accepts (the Supabase Free plan caps files at 50 MB). */
  maxProjectBytes = 50 * 1024 * 1024;
  private listeners = new Set<() => void>();

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  async init() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (!r.headers.get('content-type')?.includes('json')) throw new Error('no backend');
      const data = await r.json();
      this.available = true;
      this.oauthConfigured = !!data.oauthConfigured;
      if (typeof data.maxProjectBytes === 'number') this.maxProjectBytes = data.maxProjectBytes;
      this.user = data.user ?? null;
    } catch {
      this.available = false;
      this.user = null;
    }
    this.emit();
  }

  login() {
    location.href = `/api/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`;
  }

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    this.user = null;
    this.emit();
  }

  async list(): Promise<CloudProject[]> {
    const r = await fetch('/api/projects', { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async upload(p: Project): Promise<void> {
    const blob = await exportOsz(p);
    if (blob.size > this.maxProjectBytes) throw new Error(tooLargeMessage(projectTitle(p), blob.size, this.maxProjectBytes));
    const id = encodeURIComponent(p.id);
    const { uploadId, uploadUrl } = await apiJson<{ uploadId: string; uploadUrl: string }>(`/api/projects/${id}/upload`, { size: blob.size });
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    if (!put.ok) {
      // Supabase Storage answers 400 with code EntityTooLarge when the bucket's file size limit is hit.
      const text = await put.text().catch(() => '');
      if (put.status === 413 || text.includes('EntityTooLarge')) throw new Error(tooLargeMessage(projectTitle(p), blob.size, this.maxProjectBytes));
      throw new Error(`Upload to storage failed (HTTP ${put.status})`);
    }
    await apiJson(`/api/projects/${id}/commit`, { uploadId, title: projectTitle(p), createdAt: p.createdAt, updatedAt: p.updatedAt });
    await markSynced(p.id, p.updatedAt);
  }

  async download(meta: CloudProject): Promise<Project> {
    const r = await fetch(`/api/projects/${encodeURIComponent(meta.id)}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { url } = (await r.json()) as { url: string };
    const data = await fetch(url);
    if (!data.ok) throw new Error(`Download from storage failed (HTTP ${data.status})`);
    const p = await importOsz(await data.arrayBuffer());
    p.id = meta.id;
    p.updatedAt = meta.updatedAt;
    p.createdAt = meta.createdAt;
    return p;
  }

  async remove(id: string): Promise<void> {
    await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
  }

  /** Two-way sync, newest wins. Returns the number of projects transferred. */
  async syncAll(): Promise<number> {
    if (!this.user) return 0;
    const [remote, local] = await Promise.all([this.list(), listProjectsLocal()]);
    const localById = new Map(local.map((l) => [l.id, l]));
    const remoteById = new Map(remote.map((r) => [r.id, r]));
    let n = 0;
    // One map failing (e.g. over the size limit) shouldn't stop the others from syncing.
    const failures: string[] = [];
    for (const r of remote) {
      const l = localById.get(r.id);
      if (!l || r.updatedAt > l.updatedAt) {
        try {
          const p = await this.download(r);
          await saveProjectLocal(p, r.updatedAt);
          n++;
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

function tooLargeMessage(title: string, size: number, max: number) {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0);
  return `"${title}" is ${mb(size)} MB as an .osz, over the ${mb(max)} MB cloud sync limit (the Supabase Free plan's maximum file size). It's still saved in this browser; use File → Export package (.osz) to keep a copy.`;
}

async function apiJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export const cloud = new Cloud();
