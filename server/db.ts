import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
}

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      country_code TEXT NOT NULL DEFAULT '',
      refresh_token TEXT,
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY (user_id, id)
    );
  `);

  return {
    upsertUser(u: UserRow, refreshToken: string | null) {
      const now = Date.now();
      db.prepare(
        `INSERT INTO users (id, username, avatar_url, country_code, refresh_token, created_at, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET username = excluded.username, avatar_url = excluded.avatar_url,
           country_code = excluded.country_code, refresh_token = excluded.refresh_token, last_login = excluded.last_login`,
      ).run(u.id, u.username, u.avatar_url, u.country_code, refreshToken, now, now);
    },
    createSession(token: string, userId: number, ttlMs: number) {
      const now = Date.now();
      db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, now + ttlMs);
    },
    userForSession(token: string): UserRow | undefined {
      return db
        .prepare(
          `SELECT u.id, u.username, u.avatar_url, u.country_code FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > ?`,
        )
        .get(token, Date.now()) as UserRow | undefined;
    },
    deleteSession(token: string) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    },
    pruneSessions() {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    },
    listProjects(userId: number): ProjectRow[] {
      return db
        .prepare('SELECT id, title, created_at, updated_at, size FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
        .all(userId) as unknown as ProjectRow[];
    },
    getProject(userId: number, id: string): ProjectRow | undefined {
      return db.prepare('SELECT id, title, created_at, updated_at, size FROM projects WHERE user_id = ? AND id = ?').get(userId, id) as ProjectRow | undefined;
    },
    putProject(userId: number, p: ProjectRow) {
      db.prepare(
        `INSERT INTO projects (user_id, id, title, created_at, updated_at, size) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at, size = excluded.size`,
      ).run(userId, p.id, p.title, p.created_at, p.updated_at, p.size);
    },
    deleteProject(userId: number, id: string) {
      db.prepare('DELETE FROM projects WHERE user_id = ? AND id = ?').run(userId, id);
    },
    totalSize(userId: number): number {
      const row = db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM projects WHERE user_id = ?').get(userId) as { total: number };
      return row.total;
    },
  };
}

export type Db = ReturnType<typeof openDb>;
