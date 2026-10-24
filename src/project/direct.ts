// Searching published beatmaps (osu!direct in the browser) through osu.direct's search API, which answers browsers
// directly (CORS). Downloads go through cloud.fetchBeatmapset's mirrors.

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
}

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
}

export async function searchBeatmapsets(q: DirectQuery, signal?: AbortSignal): Promise<DirectSet[]> {
  const params = new URLSearchParams({ query: q.query.trim(), amount: String(PAGE_SIZE), offset: String(q.offset), sort: SORT[q.sort] });
  if (q.mode !== null) params.set('mode', String(q.mode));
  const status = STATUS[q.status];
  if (status !== null) params.set('status', status);
  const r = await fetch(`https://osu.direct/api/v2/search?${params}`, { signal });
  if (!r.ok) throw new Error(`Beatmap search failed (HTTP ${r.status}).`);
  const data = (await r.json()) as ApiSet[];
  if (!Array.isArray(data)) return [];
  return data.map((s) => ({
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
  }));
}
