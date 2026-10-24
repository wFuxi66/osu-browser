// Data layer on Supabase: users, sessions and the project list live in Postgres (see
// supabase/migrations), .osz packages in the private "projects" storage bucket. Uses the service role key,
// so this module must only ever run on the server.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export interface UserRow {
  id: number;
  username: string;
  avatar_url: string;
  country_code: string;
}

export interface ProjectRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  size: number;
  object_path: string;
}

export interface PendingUpload {
  object_path: string;
  project_id: string;
  size: number;
  expires_at: string;
}

const BUCKET = 'projects';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

export function openDb(url: string, serviceKey: string) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const bucket = () => sb.storage.from(BUCKET);

  return {
    async upsertUser(u: UserRow) {
      check(await sb.from('users').upsert({ ...u, last_login: new Date().toISOString() }));
    },
    async createSession(token: string, userId: number, ttlMs: number) {
      check(await sb.from('sessions').insert({ token_hash: hashToken(token), user_id: userId, expires_at: new Date(Date.now() + ttlMs).toISOString() }));
    },
    async userForSession(token: string): Promise<UserRow | undefined> {
      const row = check(
        await sb
          .from('sessions')
          .select('users(id, username, avatar_url, country_code)')
          .eq('token_hash', hashToken(token))
          .gt('expires_at', new Date().toISOString())
          .maybeSingle(),
      ) as { users: UserRow | null } | null;
      return row?.users ?? undefined;
    },
    async deleteSession(token: string) {
      check(await sb.from('sessions').delete().eq('token_hash', hashToken(token)));
    },
    async pruneSessions() {
      check(await sb.from('sessions').delete().lte('expires_at', new Date().toISOString()));
    },

    async listProjects(userId: number): Promise<ProjectRow[]> {
      return check(
        await sb.from('projects').select('id, title, created_at, updated_at, size, object_path').eq('user_id', userId).order('updated_at', { ascending: false }),
      ) ?? [];
    },
    async getProject(userId: number, id: string): Promise<ProjectRow | undefined> {
      return (
        check(await sb.from('projects').select('id, title, created_at, updated_at, size, object_path').eq('user_id', userId).eq('id', id).maybeSingle()) ??
        undefined
      );
    },
    async putProject(userId: number, p: ProjectRow) {
      check(await sb.from('projects').upsert({ user_id: userId, ...p }));
    },
    async deleteProject(userId: number, id: string) {
      check(await sb.from('projects').delete().eq('user_id', userId).eq('id', id));
    },

    async listPending(userId: number): Promise<PendingUpload[]> {
      return check(await sb.from('pending_uploads').select('object_path, project_id, size, expires_at').eq('user_id', userId)) ?? [];
    },
    async addPending(userId: number, p: PendingUpload) {
      check(await sb.from('pending_uploads').insert({ user_id: userId, ...p }));
    },
    async deletePending(paths: string[]) {
      if (paths.length) check(await sb.from('pending_uploads').delete().in('object_path', paths));
    },

    /** Signed URL the browser PUTs the .osz to directly (valid for 2 hours, fixed by Supabase). */
    async signedUploadUrl(path: string): Promise<string> {
      return check(await bucket().createSignedUploadUrl(path))!.signedUrl;
    },
    async signedDownloadUrl(path: string, expiresInSec = 300): Promise<string> {
      return check(await bucket().createSignedUrl(path, expiresInSec))!.signedUrl;
    },
    /** Size of a stored object and its first bytes, or undefined if it doesn't exist. */
    async inspectObject(path: string): Promise<{ size: number; head: Uint8Array } | undefined> {
      const slash = path.lastIndexOf('/');
      const files = check(await bucket().list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 10 })) ?? [];
      const file = files.find((f) => f.name === path.slice(slash + 1));
      if (!file) return undefined;
      const res = await fetch(await this.signedDownloadUrl(path, 60), { headers: { Range: 'bytes=0-3' } });
      if (!res.ok) return undefined;
      return { size: Number(file.metadata?.size ?? 0), head: new Uint8Array(await res.arrayBuffer()).slice(0, 4) };
    },
    async removeObjects(paths: string[]) {
      if (paths.length) check(await bucket().remove(paths));
    },
  };
}

export type Db = ReturnType<typeof openDb>;
