// The user's own Google Drive as cloud storage for their beatmaps. Each project is one file in an "osu-browser"
// folder, tagged with app properties (project id and timestamps) so sync can find it again. With the
// drive.file scope the app can only see files it created. Short-lived access tokens come from our API
// (server/drive.ts), which keeps the refresh token in an encrypted cookie.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_FOLDER = 'osu-browser';
/** App property marking our folder ("folder") and project files ("project"). */
const APP_KEY = 'osuWebEditor';

export interface DriveProject {
  fileId: string;
  /** The project's id (same on every device). */
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  size: number;
}

export interface DriveUpload {
  id: string;
  createdAt: number;
  updatedAt: number;
  fileName: string;
  description: string;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function driveError(r: Response): Promise<string> {
  const body = (await r.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
  const reason = body?.error?.errors?.[0]?.reason;
  if (reason === 'storageQuotaExceeded') return 'Your Google Drive is full. Free up some space to keep syncing.';
  return `Google Drive: ${body?.error?.message ?? `HTTP ${r.status}`}`;
}

class Drive {
  private token: { value: string; expires: number } | null = null;
  private folderId: string | null = null;
  /** The settings file's id ('' when there is none yet), once looked up. */
  private settingsId: string | null = null;
  /** Called when the server says Drive isn't connected (any more). */
  onDisconnected: (() => void) | null = null;

  private async accessToken(fresh: boolean): Promise<string> {
    if (!fresh && this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const r = await fetch('/api/drive/token', { method: 'POST', credentials: 'include' });
    if (r.status === 401) {
      this.token = null;
      this.onDisconnected?.();
      throw new Error((await r.text().catch(() => '')) || 'Google Drive is not connected.');
    }
    if (!r.ok) throw new Error(`Couldn't reach Google Drive (HTTP ${r.status}).`);
    const t = (await r.json()) as { accessToken: string; expiresIn: number };
    this.token = { value: t.accessToken, expires: Date.now() + t.expiresIn * 1000 };
    return t.accessToken;
  }

  /** A Drive API request with the access token, retried once with a fresh token if it was rejected. */
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${await this.accessToken(attempt > 0)}`);
      const r = await fetch(url, { ...init, headers });
      if (r.status === 401 && attempt === 0) continue;
      if (!r.ok) throw new Error(await driveError(r));
      return r;
    }
  }

  private async search<T>(q: string, fields: string): Promise<T[]> {
    const out: T[] = [];
    let page = '';
    do {
      const url = `${API}/files?spaces=drive&pageSize=1000&q=${encodeURIComponent(q)}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
      const r = (await (await this.call(url)).json()) as { files?: T[]; nextPageToken?: string };
      out.push(...(r.files ?? []));
      page = r.nextPageToken ?? '';
    } while (page);
    return out;
  }

  private async folder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const [found] = await this.search<{ id: string; name: string }>(
      `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='${APP_KEY}' and value='folder' }`,
      'id,name',
    );
    if (found) {
      // Folders made before the app was renamed take the new name (it's found by its app property, not its name).
      if (found.name !== DRIVE_FOLDER) {
        void this.call(`${API}/files/${found.id}?fields=id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ name: DRIVE_FOLDER }),
        }).catch(() => undefined);
      }
      return (this.folderId = found.id);
    }
    const r = await this.call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder', appProperties: { [APP_KEY]: 'folder' } }),
    });
    return (this.folderId = ((await r.json()) as { id: string }).id);
  }

  /** Every synced project, newest copy per project id. */
  async list(): Promise<DriveProject[]> {
    const files = await this.search<{ id: string; name: string; size?: string; appProperties?: Record<string, string> }>(
      `trashed=false and appProperties has { key='${APP_KEY}' and value='project' }`,
      'id,name,size,appProperties',
    );
    const byId = new Map<string, DriveProject>();
    for (const f of files) {
      const a = f.appProperties ?? {};
      const p: DriveProject = {
        fileId: f.id,
        id: a.projectId ?? '',
        title: f.name.replace(/( \(edited files only\))?\.(osz|zip)$/i, ''),
        createdAt: Number(a.createdAt) || 0,
        updatedAt: Number(a.updatedAt) || 0,
        size: Number(f.size) || 0,
      };
      if (!p.id) continue;
      const prev = byId.get(p.id);
      if (!prev || p.updatedAt > prev.updatedAt) byId.set(p.id, p);
    }
    return [...byId.values()];
  }

  private async fileFor(projectId: string): Promise<string | undefined> {
    const files = await this.search<{ id: string }>(`trashed=false and appProperties has { key='projectId' and value=${quote(projectId)} }`, 'id');
    return files[0]?.id;
  }

  /** Creates or replaces a project's file (resumable upload, so large sets work too). */
  async upload(meta: DriveUpload, blob: Blob): Promise<void> {
    const existing = await this.fileFor(meta.id);
    const body: Record<string, unknown> = {
      name: meta.fileName,
      description: meta.description,
      appProperties: { [APP_KEY]: 'project', projectId: meta.id, createdAt: String(meta.createdAt), updatedAt: String(meta.updatedAt) },
    };
    if (!existing) body.parents = [await this.folder()];
    const start = await this.call(existing ? `${UPLOAD}/files/${existing}?uploadType=resumable` : `${UPLOAD}/files?uploadType=resumable`, {
      method: existing ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': blob.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify(body),
    });
    const session = start.headers.get('Location');
    if (!session) throw new Error('Google Drive did not start the upload.');
    const put = await fetch(session, { method: 'PUT', body: blob });
    if (!put.ok) throw new Error(await driveError(put));
  }

  /** The synced settings file: when it was saved and its contents, or null if there isn't one yet. */
  async getSettings(): Promise<{ updatedAt: number; data: unknown } | null> {
    const [f] = await this.search<{ id: string; appProperties?: Record<string, string> }>(
      `trashed=false and appProperties has { key='${APP_KEY}' and value='settings' }`,
      'id,appProperties',
    );
    if (!f) return null;
    this.settingsId = f.id;
    const data = await (await this.call(`${API}/files/${encodeURIComponent(f.id)}?alt=media`)).json();
    return { updatedAt: Number(f.appProperties?.updatedAt) || 0, data };
  }

  /** Creates or replaces the settings file (a small JSON, so a single multipart upload). */
  async putSettings(data: unknown, updatedAt: number): Promise<void> {
    if (this.settingsId === null) {
      const [f] = await this.search<{ id: string }>(`trashed=false and appProperties has { key='${APP_KEY}' and value='settings' }`, 'id');
      this.settingsId = f?.id ?? '';
    }
    const meta: Record<string, unknown> = {
      name: 'settings.json',
      description: 'osu!browser settings (key bindings, volumes, display options), synced between your computers.',
      mimeType: 'application/json',
      appProperties: { [APP_KEY]: 'settings', updatedAt: String(updatedAt) },
    };
    if (!this.settingsId) meta.parents = [await this.folder()];
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const r = await this.call(
      this.settingsId ? `${UPLOAD}/files/${encodeURIComponent(this.settingsId)}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`,
      { method: this.settingsId ? 'PATCH' : 'POST', body: form },
    );
    this.settingsId = ((await r.json()) as { id: string }).id;
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    return (await this.call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).arrayBuffer();
  }

  /** Moves a project's file to the Drive trash (recoverable there for 30 days). */
  async remove(projectId: string): Promise<void> {
    const fileId = await this.fileFor(projectId);
    if (!fileId) return;
    await this.call(`${API}/files/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async disconnect(): Promise<void> {
    this.token = null;
    this.folderId = null;
    this.settingsId = null;
    await fetch('/api/drive/logout', { method: 'POST', credentials: 'include' });
  }
}

export const drive = new Drive();
