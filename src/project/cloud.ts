// Client for the optional backend: osu! OAuth login and per-account project sync.
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
    const r = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Title': encodeURIComponent(projectTitle(p)),
        'X-Updated-At': String(p.updatedAt),
        'X-Created-At': String(p.createdAt),
      },
      body: blob,
    });
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || `HTTP ${r.status}`);
    await markSynced(p.id, p.updatedAt);
  }

  async download(meta: CloudProject): Promise<Project> {
    const r = await fetch(`/api/projects/${encodeURIComponent(meta.id)}`, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const p = await importOsz(await r.arrayBuffer());
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
    for (const r of remote) {
      const l = localById.get(r.id);
      if (!l || r.updatedAt > l.updatedAt) {
        const p = await this.download(r);
        await saveProjectLocal(p, r.updatedAt);
        n++;
      }
    }
    for (const l of local) {
      const r = remoteById.get(l.id);
      if ((!r || l.updatedAt > r.updatedAt) && l.updatedAt > l.syncedAt) {
        const p = await loadProjectLocal(l.id);
        if (p) {
          await this.upload(p);
          n++;
        }
      }
    }
    return n;
  }

  /** Fetch a published beatmapset (.osz) by id through the backend's mirror proxy. */
  async fetchBeatmapset(setId: number): Promise<ArrayBuffer> {
    const r = await fetch(`/api/mirror/${setId}`, { credentials: 'include' });
    if (!r.ok) throw new Error((await r.text().catch(() => '')) || `HTTP ${r.status}`);
    return r.arrayBuffer();
  }
}

export const cloud = new Cloud();
