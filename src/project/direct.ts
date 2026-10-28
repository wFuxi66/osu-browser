// Searching published beatmaps (osu!direct in the browser) through osu.direct's search API, which answers browsers
// directly (CORS), and the logged-in user's own sets (My beatmaps) from the osu! API through our server. Downloads go
// through cloud.fetchBeatmapset's mirrors.

export type DirectStatus = 'ranked' | 'loved' | 'qualified' | 'pending' | 'graveyard' | 'any';
export type DirectSort = 'plays' | 'favourites' | 'ranked' | 'newest';

export interface DirectQuery {
  query: string;
  /** 0–3, or null for every mode. */
  mode: number | null;
  status: DirectStatus;
  sort: DirectSort;
  offset: number;
}

export interface DirectDifficulty {
  id: number;
  version: string;
  mode: number;
  stars: number;
  length: number;
}

export interface DirectSet {
  id: number;
  artist: string;
  title: string;
  creator: string;
  status: string;
  bpm: number;
  plays: number;
  favourites: number;
  video: boolean;
  storyboard: boolean;
  /** 900x250 card cover and the small list thumbnail. */
  card: string;
  thumb: string;
  preview: string;
  difficulties: DirectDifficulty[];
  /** When the set was ranked (or loved / qualified) and last updated (ms). */
  ranked?: number;
  updated?: number;
  /** The set's forum thread. */
  thread?: string;
  /** For My beatmaps: which of the user's lists the set is in. */
  kind?: MyKind;
}

/** The osu! API's lists of a user's sets (pending includes WIP; guest is sets they made a guest difficulty for). */
export type MyKind = 'pending' | 'ranked' | 'loved' | 'guest' | 'graveyard';

export const PAGE_SIZE = 30;

const STATUS: Record<DirectStatus, string | null> = {
  ranked: '1,2',
  loved: '4',
  qualified: '3',
  pending: '0,-1',
  graveyard: '-2',
  any: null,
};

const SORT: Record<DirectSort, string> = {
  plays: 'play_count:desc',
  favourites: 'favourite_count:desc',
  ranked: 'ranked_date:desc',
  newest: 'submitted_date:desc',
};

interface ApiBeatmap {
  id: number;
  version: string;
  mode_int: number;
  difficulty_rating: number;
  total_length: number;
}

interface ApiSet {
  id: number;
  artist: string;
  title: string;
  creator: string;
  status: string;
  bpm: number;
  play_count: number;
  favourite_count: number;
  video: boolean;
  storyboard: boolean;
  covers?: { card?: string; list?: string };
  preview_url?: string;
  beatmaps?: ApiBeatmap[];
  kind?: MyKind;
  last_updated?: string;
  ranked_date?: string | null;
  legacy_thread_url?: string | null;
}

export async function searchBeatmapsets(q: DirectQuery, signal?: AbortSignal): Promise<DirectSet[]> {
  const params = new URLSearchParams({ query: q.query.trim(), amount: String(PAGE_SIZE), offset: String(q.offset), sort: SORT[q.sort] });
  if (q.mode !== null) params.set('mode', String(q.mode));
  const status = STATUS[q.status];
  if (status !== null) params.set('status', status);
  if (!navigator.onLine) throw new Error("You're offline. Searching beatmaps needs an internet connection.");
  const r = await fetch(`https://osu.direct/api/v2/search?${params}`, { signal });
  if (!r.ok) throw new Error(`Beatmap search failed (HTTP ${r.status}).`);
  const data = (await r.json()) as ApiSet[];
  return Array.isArray(data) ? data.map(toDirectSet) : [];
}

/** The logged-in user's uploaded sets and guest difficulties, newest first. */
export async function myBeatmapsets(signal?: AbortSignal): Promise<DirectSet[]> {
  if (!navigator.onLine) throw new Error("You're offline. Your beatmaps on osu! need an internet connection.");
  const r = await fetch('/api/me/beatmapsets', { credentials: 'include', signal });
  if (!r.ok) throw new Error(r.status === 401 ? 'Log in with osu! to see your beatmaps.' : `Couldn't list your beatmaps (HTTP ${r.status}).`);
  const data = (await r.json()) as ApiSet[];
  return data.map(toDirectSet).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}

function toDirectSet(s: ApiSet): DirectSet {
  return {
    id: s.id,
    artist: s.artist,
    title: s.title,
    creator: s.creator,
    status: s.status,
    bpm: s.bpm,
    plays: s.play_count,
    favourites: s.favourite_count,
    video: s.video,
    storyboard: s.storyboard,
    card: s.covers?.card ?? `https://assets.ppy.sh/beatmaps/${s.id}/covers/card.jpg`,
    thumb: s.covers?.list ?? `https://assets.ppy.sh/beatmaps/${s.id}/covers/list.jpg`,
    preview: s.preview_url ? s.preview_url.replace(/^\/\//, 'https://') : `https://b.ppy.sh/preview/${s.id}.mp3`,
    difficulties: (s.beatmaps ?? [])
      .map((b) => ({ id: b.id, version: b.version, mode: b.mode_int, stars: b.difficulty_rating, length: b.total_length }))
      .sort((a, b) => a.mode - b.mode || a.stars - b.stars),
    ranked: s.ranked_date ? Date.parse(s.ranked_date) : undefined,
    updated: s.last_updated ? Date.parse(s.last_updated) : undefined,
    // From a third-party API: only ever an https link.
    thread: s.legacy_thread_url?.startsWith('https://') ? s.legacy_thread_url : undefined,
    kind: s.kind,
  };
}
