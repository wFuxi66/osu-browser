// Local scores: plays stay in this browser (the point is test-playing your own maps), shown in song select's
// "Local Ranking" and on the ranking screen, like stable's local leaderboard.
import { useSyncExternalStore } from 'react';
import { sortMods, type ModId } from './mods';

export type Grade = 'XH' | 'X' | 'SH' | 'S' | 'A' | 'B' | 'C' | 'D';

export interface Counts {
  n300: number;
  n100: number;
  n50: number;
  nMiss: number;
  /** 激: a combo finished with only 300s. */
  nGeki: number;
  /** 喝: a combo finished with 300s and 100s. */
  nKatu: number;
}

export interface Score extends Counts {
  id: string;
  diffId: string;
  /** The difficulty's checksum when it was played: an edited map no longer matches it. */
  checksum: string;
  player: string;
  date: number;
  mods: ModId[];
  score: number;
  maxCombo: number;
  /** The best combo the map allows, to tell a full combo. */
  mapMaxCombo: number;
  accuracy: number;
  grade: Grade;
  /** Health over the play (0–1), for the ranking screen's graph. */
  hp: number[];
  /** Hit errors in ms: average early and late, and the unstable rate. */
  errorEarly: number;
  errorLate: number;
  unstableRate: number;
}

export function accuracyOf(c: Counts): number {
  const total = c.n300 + c.n100 + c.n50 + c.nMiss;
  return total ? (c.n300 * 300 + c.n100 * 100 + c.n50 * 50) / (total * 300) : 1;
}

/** Stable's osu!standard grades; Hidden and Flashlight make SS and S silver. */
export function gradeOf(c: Counts, mods: ModId[]): Grade {
  const total = c.n300 + c.n100 + c.n50 + c.nMiss;
  const silver = mods.includes('HD') || mods.includes('FL');
  if (!total || c.n300 === total) return silver ? 'XH' : 'X';
  const r300 = c.n300 / total;
  const r50 = c.n50 / total;
  if (r300 > 0.9 && r50 < 0.01 && c.nMiss === 0) return silver ? 'SH' : 'S';
  if ((r300 > 0.8 && c.nMiss === 0) || r300 > 0.9) return 'A';
  if ((r300 > 0.7 && c.nMiss === 0) || r300 > 0.8) return 'B';
  if (r300 > 0.6) return 'C';
  return 'D';
}

/** Mean early/late error and the unstable rate (10 × the standard deviation) of a play's hit errors. */
export function errorStats(errors: number[]) {
  const early = errors.filter((e) => e < 0);
  const late = errors.filter((e) => e >= 0);
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const mu = mean(errors);
  const variance = mean(errors.map((e) => (e - mu) ** 2));
  return { errorEarly: mean(early), errorLate: mean(late), unstableRate: Math.sqrt(variance) * 10 };
}

// ------------------------------------------------------------------ storage

const KEY = 'osu-web-editor:scores';
const PER_DIFFICULTY = 50;

type Stored = Record<string, Score[]>;

function read(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored;
  } catch {
    return {};
  }
}

let cache: Stored = read();
let rev = 0;
const listeners = new Set<() => void>();

function write(next: Stored) {
  cache = next;
  rev++;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable: the scores stay for this session */
  }
  for (const l of listeners) l();
}

export const scores = {
  /** A difficulty's scores, best first. */
  for(diffId: string): Score[] {
    return cache[diffId] ?? [];
  },
  /** Saves a play; returns its rank among the difficulty's scores (1 = best). */
  add(s: Score): number {
    const list = [...(cache[s.diffId] ?? []), { ...s, mods: sortMods(s.mods) }].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, PER_DIFFICULTY);
    write({ ...cache, [s.diffId]: list });
    return list.findIndex((x) => x.id === s.id) + 1;
  },
  remove(diffId: string, id: string) {
    write({ ...cache, [diffId]: (cache[diffId] ?? []).filter((x) => x.id !== id) });
  },
  clear(diffId?: string) {
    if (!diffId) return write({});
    const next = { ...cache };
    delete next[diffId];
    write(next);
  },
  /** Plays, average accuracy and total score over every local score, for the main menu's user panel. */
  totals() {
    const all = Object.values(cache).flat();
    return {
      plays: all.length,
      accuracy: all.length ? all.reduce((s, x) => s + x.accuracy, 0) / all.length : 0,
      totalScore: all.reduce((s, x) => s + x.score, 0),
    };
  },
};

export function useScores(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => rev,
  );
}
