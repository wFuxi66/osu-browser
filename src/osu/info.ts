// Song select statistics for one difficulty: what stable shows in the top-left info panel.
import { objectEndTime } from './timing';
import type { Beatmap, GameMode } from './types';

export interface BeatmapInfo {
  version: string;
  mode: GameMode;
  hp: number;
  cs: number;
  od: number;
  ar: number;
  circles: number;
  sliders: number;
  spinners: number;
  /** Song time at the end of the last object, in ms (what stable shows as Length). */
  length: number;
  bpmMin: number;
  bpmMax: number;
  /** BPM of the timing section that covers the most of the map. */
  bpmMain: number;
  previewTime: number;
  /** Star rating, or null when it can't be computed for this mode. */
  stars: number | null;
}

export function beatmapInfo(bm: Beatmap, stars: number | null = null): BeatmapInfo {
  const objs = bm.hitObjects;
  let circles = 0;
  let sliders = 0;
  let spinners = 0;
  for (const o of objs) {
    if (o.kind === 'circle') circles++;
    else if (o.kind === 'slider' || o.kind === 'hold') sliders++;
    else spinners++;
  }
  const first = objs[0]?.time ?? 0;
  const last = objs.reduce((m, o) => Math.max(m, objectEndTime(bm, o)), first);
  const reds = bm.timingPoints.filter((t) => t.uninherited && t.beatLength > 0);
  const bpms = reds.map((t) => 60000 / t.beatLength);
  const durations = new Map<number, number>();
  for (let i = 0; i < reds.length; i++) {
    const start = i === 0 ? Math.min(reds[i].time, first) : reds[i].time;
    const end = i + 1 < reds.length ? reds[i + 1].time : Math.max(last, start);
    const bpm = Math.round(bpms[i] * 100) / 100;
    durations.set(bpm, (durations.get(bpm) ?? 0) + Math.max(0, end - start));
  }
  let bpmMain = bpms[0] ?? 0;
  let best = -1;
  for (const [bpm, d] of durations) if (d > best) [bpmMain, best] = [bpm, d];
  const d = bm.difficulty;
  return {
    version: bm.metadata.version,
    mode: bm.general.mode,
    hp: d.hpDrainRate,
    cs: d.circleSize,
    od: d.overallDifficulty,
    ar: d.approachRate,
    circles,
    sliders,
    spinners,
    length: objs.length ? last : 0,
    bpmMin: bpms.length ? Math.min(...bpms) : 0,
    bpmMax: bpms.length ? Math.max(...bpms) : 0,
    bpmMain,
    previewTime: bm.general.previewTime,
    stars,
  };
}

/** "02:15" style length. */
export function formatLength(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Stable's BPM readout: "205", or "170-205 (180)" when it changes. */
export function formatBpm(i: BeatmapInfo): string {
  const r = (v: number) => String(Math.round(v));
  if (!i.bpmMax) return '0';
  if (Math.round(i.bpmMin) === Math.round(i.bpmMax)) return r(i.bpmMain);
  return `${r(i.bpmMin)}-${r(i.bpmMax)} (${r(i.bpmMain)})`;
}

// Readouts call fmt on every frame, and toLocaleString with options builds a new formatter each time.
const formats = new Map<number, Intl.NumberFormat>();

/** Numbers in the viewer's locale, like stable ("7,85" on a French system). */
export function fmt(v: number, digits = 1): string {
  let f = formats.get(digits);
  if (!f) formats.set(digits, (f = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })));
  return f.format(v);
}
