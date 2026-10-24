// Data layer on Supabase: osu! users and login sessions in Postgres (see supabase/migrations). Uses the
// service role key, so this module must only ever run on the server.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export interface UserRow {
  id: number;
  username: string;
  avatar_url: string;
  country_code: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

export function openDb(url: string, serviceKey: string) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

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
  };
}

export type Db = ReturnType<typeof openDb>;
