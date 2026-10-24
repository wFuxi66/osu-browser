// Song select search, grouping and sorting, modelled on stable's carousel.
import { MODE_NAMES } from '../osu/types';
import type { DifficultySummary, ProjectSummary } from '../project/storage';

export type GroupMode = 'none' | 'artist' | 'bpm' | 'creator' | 'date' | 'length' | 'mode' | 'title';
export type SortMode = 'artist' | 'bpm' | 'creator' | 'date' | 'difficulty' | 'length' | 'title';

export const GROUP_LABELS: Record<GroupMode, string> = {
  none: 'No Grouping',
  artist: 'By Artist',
  bpm: 'By BPM',
  creator: 'By Creator',
  date: 'By Date Added',
  length: 'By Length',
  mode: 'By Mode',
  title: 'By Title',
};

export const SORT_LABELS: Record<SortMode, string> = {
  artist: 'By Artist',
  bpm: 'By BPM',
  creator: 'By Creator',
  date: 'By Date Added',
  difficulty: 'By Difficulty',
  length: 'By Length',
  title: 'By Title',
};

type Cmp = '=' | '!=' | '<' | '>' | '<=' | '>=';

interface Criterion {
  key: string;
  op: Cmp;
  value: string;
}

/** Parse "ar>9 stars>=5 kokoro" into numeric/text criteria plus free-text words. */
export function parseSearch(q: string): { criteria: Criterion[]; words: string[] } {
  const criteria: Criterion[] = [];
  const words: string[] = [];
  for (const tok of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = /^([a-z]+)(<=|>=|!=|=|<|>|:)(.+)$/.exec(tok);
    if (m && FIELDS.has(m[1])) criteria.push({ key: m[1], op: (m[2] === ':' ? '=' : m[2]) as Cmp, value: m[3] });
    else words.push(tok);
  }
  return { criteria, words };
}

const FIELDS = new Set(['ar', 'cs', 'od', 'hp', 'stars', 'star', 'sr', 'bpm', 'length', 'objects', 'keys', 'mode', 'creator', 'mapper', 'artist', 'title', 'diff', 'version']);

function compare(a: number | string, op: Cmp, b: string): boolean {
  if (typeof a === 'string') {
    const v = a.toLowerCase();
    return op === '!=' ? !v.includes(b) : v.includes(b);
  }
  const n = Number(b.replace(',', '.'));
  if (!Number.isFinite(n)) return false;
  switch (op) {
    case '=': return Math.abs(a - n) < 0.05;
    case '!=': return Math.abs(a - n) >= 0.05;
    case '<': return a < n;
    case '>': return a > n;
    case '<=': return a <= n + 0.0001;
    case '>=': return a >= n - 0.0001;
  }
}

function field(set: ProjectSummary, d: DifficultySummary, key: string): number | string | null {
  switch (key) {
    case 'ar': return d.ar;
    case 'cs': return d.cs;
    case 'od': return d.od;
    case 'hp': return d.hp;
    case 'stars': case 'star': case 'sr': return d.stars ?? null;
    case 'bpm': return d.bpmMain;
    case 'length': return d.length / 1000;
    case 'objects': return d.circles + d.sliders + d.spinners;
    case 'keys': return d.mode === 3 ? Math.round(d.cs) : null;
    case 'mode': return `${MODE_NAMES[d.mode]} ${['osu', 'taiko', 'catch', 'mania'][d.mode]} ${['std', 'taiko', 'ctb', 'mania'][d.mode]}`;
    case 'creator': case 'mapper': return set.creator;
    case 'artist': return `${set.artist} ${set.artistUnicode}`;
    case 'title': return `${set.songTitle} ${set.titleUnicode}`;
    case 'diff': case 'version': return d.version;
  }
  return null;
}

export function matches(set: ProjectSummary, d: DifficultySummary, search: ReturnType<typeof parseSearch>): boolean {
  for (const c of search.criteria) {
    const v = field(set, d, c.key);
    if (v === null || !compare(v, c.op, c.value)) return false;
  }
  if (!search.words.length) return true;
  const hay = `${set.artist} ${set.artistUnicode} ${set.songTitle} ${set.titleUnicode} ${set.creator} ${set.source} ${set.tags} ${d.version}`.toLowerCase();
  return search.words.every((w) => hay.includes(w));
}

const maxStars = (s: ProjectSummary) => Math.max(0, ...s.difficulties.map((d) => d.stars ?? d.od));
const first = (s: ProjectSummary) => s.difficulties[0];

export function sortSets(sets: ProjectSummary[], mode: SortMode): ProjectSummary[] {
  const key: Record<SortMode, (s: ProjectSummary) => number | string> = {
    artist: (s) => s.artist.toLowerCase(),
    bpm: (s) => first(s)?.bpmMain ?? 0,
    creator: (s) => s.creator.toLowerCase(),
    date: (s) => -s.createdAt,
    difficulty: maxStars,
    length: (s) => Math.max(0, ...s.difficulties.map((d) => d.length)),
    title: (s) => s.songTitle.toLowerCase(),
  };
  const k = key[mode];
  return [...sets].sort((a, b) => {
    const x = k(a);
    const y = k(b);
    if (x < y) return -1;
    if (x > y) return 1;
    return a.songTitle.localeCompare(b.songTitle);
  });
}

/** Group name for a set; groups are listed in the returned order. */
export function groupOf(s: ProjectSummary, mode: GroupMode): { key: string; order: number | string } {
  const letter = (t: string) => {
    const c = t.trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : /[0-9]/.test(c) ? '0-9' : 'Other';
  };
  switch (mode) {
    case 'artist': { const l = letter(s.artist); return { key: l, order: l === 'Other' ? '~' : l }; }
    case 'title': { const l = letter(s.songTitle); return { key: l, order: l === 'Other' ? '~' : l }; }
    case 'creator': return { key: s.creator || 'Unknown', order: (s.creator || '~').toLowerCase() };
    case 'mode': { const m = first(s)?.mode ?? 0; return { key: MODE_NAMES[m], order: m }; }
    case 'bpm': {
      const b = first(s)?.bpmMain ?? 0;
      const caps = [60, 120, 180, 240, 300];
      const i = caps.findIndex((c) => b < c);
      return i < 0 ? { key: 'Over 300 BPM', order: 99 } : { key: `Under ${caps[i]} BPM`, order: i };
    }
    case 'length': {
      const m = Math.max(0, ...s.difficulties.map((d) => d.length)) / 60000;
      const caps = [1, 2, 3, 4, 5, 10];
      const i = caps.findIndex((c) => m <= c);
      return i < 0 ? { key: 'Over 10 minutes', order: 99 } : { key: `${caps[i]} minute${caps[i] > 1 ? 's' : ''} or less`, order: i };
    }
    case 'date': {
      const days = (Date.now() - s.createdAt) / 86400000;
      const buckets: [number, string][] = [[1, 'Today'], [2, 'Yesterday'], [7, 'Last week'], [31, 'Last month'], [92, '3 months ago'], [183, '6 months ago'], [365, 'Last year']];
      const i = buckets.findIndex(([d]) => days < d);
      return i < 0 ? { key: 'Over a year ago', order: 99 } : { key: buckets[i][1], order: i };
    }
    default: return { key: '', order: 0 };
  }
}

/** Difficulty colour by star rating (stable's bands), falling back to OD when stars are unknown. */
export function difficultyColour(d: DifficultySummary): string {
  const s = d.stars ?? d.od * 0.6;
  if (s < 2) return '#88b300';
  if (s < 2.7) return '#66ccff';
  if (s < 4) return '#ffcc22';
  if (s < 5.3) return '#ff66aa';
  if (s < 6.5) return '#8866ee';
  return '#222';
}
