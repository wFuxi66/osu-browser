// Stable's mods for osu!standard: what each one does to the beatmap, its score multiplier, which ones can't be
// combined, and the selection (song select's, and the editor's test mode's own), remembered in this browser.
import { useSyncExternalStore } from 'react';
import { preemptTime } from '../osu/processing';
import type { Beatmap } from '../osu/types';
import { cloneBeatmap } from '../project/project';

export type ModId = 'EZ' | 'NF' | 'HT' | 'HR' | 'SD' | 'PF' | 'DT' | 'NC' | 'HD' | 'FL' | 'RX' | 'AP' | 'SO' | 'AU' | 'CN' | 'V2';
export type ModRow = 'reduction' | 'increase' | 'special';

export interface ModDef {
  id: ModId;
  name: string;
  /** selection-mod-<icon>.png in a skin. */
  icon: string;
  row: ModRow;
  /** Mods sharing a tile cycle on it (Sudden Death → Perfect, Double Time → Nightcore, Autoplay → Cinema). */
  tile: number;
  multiplier: number;
  /** The multiplier under ScoreV2, where it differs. */
  v2?: number;
  /** The key that toggles it in the mod selection, like stable's (Q W E / A S D F G / Z X C V B). */
  key: string;
  description: string;
}

const m = (id: ModId, name: string, icon: string, row: ModRow, tile: number, multiplier: number, key: string, description: string, v2?: number): ModDef => ({ id, name, icon, row, tile, multiplier, key, description, v2 });

export const MODS: ModDef[] = [
  m('EZ', 'Easy', 'easy', 'reduction', 0, 0.5, 'KeyQ', 'Reduces overall difficulty: larger circles, more forgiving HP drain, less accuracy required, and three lives!'),
  m('NF', 'No Fail', 'nofail', 'reduction', 1, 0.5, 'KeyW', "You can't fail. No matter what.", 1),
  m('HT', 'Half Time', 'halftime', 'reduction', 2, 0.3, 'KeyE', 'Less zoom.'),
  m('HR', 'Hard Rock', 'hardrock', 'increase', 0, 1.06, 'KeyA', 'Everything just got a bit harder...', 1.1),
  m('SD', 'Sudden Death', 'suddendeath', 'increase', 1, 1, 'KeyS', 'Miss a note and fail.'),
  m('PF', 'Perfect', 'perfect', 'increase', 1, 1, 'KeyS', 'SS or quit.'),
  m('DT', 'Double Time', 'doubletime', 'increase', 2, 1.12, 'KeyD', 'Zoooooooooom.', 1.2),
  m('NC', 'Nightcore', 'nightcore', 'increase', 2, 1.12, 'KeyD', 'uguuuuuuuu', 1.2),
  m('HD', 'Hidden', 'hidden', 'increase', 3, 1.06, 'KeyF', 'Play with no approach circles and fading notes for a slight score advantage.'),
  m('FL', 'Flashlight', 'flashlight', 'increase', 4, 1.12, 'KeyG', 'Restricted view area.'),
  m('RX', 'Relax', 'relax', 'special', 0, 0, 'KeyZ', "You don't need to click. Give your clicking/tapping finger a break from the heat of things."),
  m('AP', 'Autopilot', 'relax2', 'special', 1, 0, 'KeyX', 'Automatic cursor movement - just follow the rhythm.'),
  m('SO', 'Spun Out', 'spunout', 'special', 2, 0.9, 'KeyC', 'Spinners will be automatically completed.'),
  m('AU', 'Autoplay', 'autoplay', 'special', 3, 1, 'KeyV', 'Watch a perfect automated play through the song.'),
  m('CN', 'Cinema', 'cinema', 'special', 3, 1, 'KeyV', 'Watch the video without visual distractions.'),
  m('V2', 'ScoreV2', 'scorev2', 'special', 4, 1, 'KeyB', 'Try the future scoring system.'),
];

export const MOD = Object.fromEntries(MODS.map((d) => [d.id, d])) as Record<ModId, ModDef>;

const INCOMPATIBLE: [ModId[], ModId[]][] = [
  [['EZ'], ['HR']],
  [['HT'], ['DT', 'NC']],
  [['NF'], ['SD', 'PF']],
  [['RX'], ['AP']],
  [['AP'], ['SO']],
  [['AU', 'CN'], ['RX', 'AP', 'SD', 'PF']],
];

/** The tile's mods in cycle order. */
export function tileMods(row: ModRow, tile: number): ModDef[] {
  return MODS.filter((d) => d.row === row && d.tile === tile);
}

/** Turns a mod on, dropping the ones it can't be combined with (and the others on its tile). */
export function withMod(mods: ModId[], id: ModId): ModId[] {
  const def = MOD[id];
  const out = new Set(mods.filter((x) => !(MOD[x].row === def.row && MOD[x].tile === def.tile)));
  for (const [a, b] of INCOMPATIBLE) {
    if (a.includes(id)) b.forEach((x) => out.delete(x));
    if (b.includes(id)) a.forEach((x) => out.delete(x));
  }
  out.add(id);
  return sortMods([...out]);
}

/** A tile clicked (or its key pressed): off → first mod → next one → off; backwards with right-click/Shift. */
export function cycleTile(mods: ModId[], row: ModRow, tile: number, back = false): ModId[] {
  const cycle = tileMods(row, tile);
  const cur = cycle.findIndex((d) => mods.includes(d.id));
  const next = back ? (cur < 0 ? cycle.length - 1 : cur - 1) : cur + 1;
  if (next < 0 || next >= cycle.length) return mods.filter((x) => !cycle.some((d) => d.id === x));
  return withMod(mods, cycle[next].id);
}

export function sortMods(mods: ModId[]): ModId[] {
  return MODS.map((d) => d.id).filter((id) => mods.includes(id));
}

export function scoreMultiplier(mods: ModId[]): number {
  const v2 = mods.includes('V2');
  return mods.reduce((k, id) => k * (v2 ? (MOD[id].v2 ?? MOD[id].multiplier) : MOD[id].multiplier), 1);
}

/** "HDHR" style, as stable's leaderboards show them; "None" without mods. */
export function modsLabel(mods: ModId[], none = ''): string {
  return mods.length ? sortMods(mods).join('') : none;
}

/** Song speed. */
export function rateOf(mods: ModId[]): number {
  return mods.includes('DT') || mods.includes('NC') ? 1.5 : mods.includes('HT') ? 0.75 : 1;
}

export const isAuto = (mods: ModId[]) => mods.includes('AU') || mods.includes('CN');

/** Mods that change a difficulty's star rating. */
export const changesStars = (mods: ModId[]) => mods.some((x) => ['EZ', 'HR', 'DT', 'NC', 'HT'].includes(x));

/** CS/AR/OD/HP under Easy and Hard Rock (before the song speed). */
export function moddedDifficulty(d: { cs: number; ar: number; od: number; hp: number }, mods: ModId[]) {
  let { cs, ar, od, hp } = d;
  if (mods.includes('EZ')) [cs, ar, od, hp] = [cs * 0.5, ar * 0.5, od * 0.5, hp * 0.5];
  if (mods.includes('HR')) [cs, ar, od, hp] = [Math.min(10, cs * 1.3), Math.min(10, ar * 1.4), Math.min(10, od * 1.4), Math.min(10, hp * 1.4)];
  return { cs, ar, od, hp };
}

/** What song select shows: the stats as they play, AR and OD included at the song's speed (AR 9 with DT reads 10.33). */
export function effectiveStats(d: { cs: number; ar: number; od: number; hp: number }, mods: ModId[]) {
  const s = moddedDifficulty(d, mods);
  const rate = rateOf(mods);
  if (rate === 1) return s;
  const preempt = preemptTime(s.ar) / rate;
  const ar = preempt > 1200 ? 5 - (preempt - 1200) / 120 : 5 + (1200 - preempt) / 150;
  const great = (80 - 6 * s.od) / rate;
  return { ...s, ar, od: (80 - great) / 6 };
}

/** The beatmap as it plays with these mods: Easy/Hard Rock difficulty, and Hard Rock's vertical flip. */
export function moddedBeatmap(bm: Beatmap, mods: ModId[]): Beatmap {
  const out = cloneBeatmap(bm);
  const d = out.difficulty;
  const s = moddedDifficulty({ cs: d.circleSize, ar: d.approachRate, od: d.overallDifficulty, hp: d.hpDrainRate }, mods);
  [d.circleSize, d.approachRate, d.overallDifficulty, d.hpDrainRate] = [s.cs, s.ar, s.od, s.hp];
  if (mods.includes('HR') && out.general.mode === 0) {
    for (const o of out.hitObjects) {
      o.y = 384 - o.y;
      if (o.kind === 'slider') for (const p of o.points) p.y = 384 - p.y;
    }
  }
  return out;
}

// ------------------------------------------------------------------ the selections

type Selection = 'play' | 'test';
const KEYS: Record<Selection, string> = { play: 'osu-web-editor:mods', test: 'osu-web-editor:test-mods' };

function load(which: Selection): ModId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS[which]) ?? '[]') as string[];
    return sortMods(v.filter((x): x is ModId => x in MOD));
  } catch {
    return [];
  }
}

const state: Record<Selection, ModId[]> = { play: load('play'), test: load('test') };
const listeners = new Set<() => void>();

export const modSelection = {
  get(which: Selection = 'play'): ModId[] {
    return state[which];
  },
  set(mods: ModId[], which: Selection = 'play') {
    state[which] = sortMods(mods);
    try {
      localStorage.setItem(KEYS[which], JSON.stringify(state[which]));
    } catch {
      /* storage unavailable */
    }
    for (const l of listeners) l();
  },
};

export function useMods(which: Selection = 'play'): ModId[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state[which],
  );
}
