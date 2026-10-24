// AiMod: automated beatmap checks, modelled on stable's verifier.
import { getSliderPath } from '../osu/curves';
import { circleRadius } from '../osu/processing';
import { objectEndTime, redLineAt, snapDivisorOf } from '../osu/timing';
import type { Beatmap, HitObject } from '../osu/types';
import { findFile, type Project } from '../project/project';
import { formatTimestamp, maniaColumn } from './store';

export interface AiModIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'Compose' | 'Timing' | 'Design' | 'Metadata' | 'Meta';
  message: string;
  time?: number;
  objectIds?: number[];
}

export function runAiMod(project: Project, bm: Beatmap): AiModIssue[] {
  const issues: AiModIssue[] = [];
  const add = (i: AiModIssue) => issues.push(i);
  const objs = bm.hitObjects;
  const reds = bm.timingPoints.filter((t) => t.uninherited);
  const mode = bm.general.mode;

  // Timing
  if (reds.length === 0) add({ severity: 'error', category: 'Timing', message: 'There are no uninherited (red) timing points.' });
  if (reds.length && objs.length && objs[0].time < reds[0].time) {
    add({ severity: 'error', category: 'Timing', message: 'Objects are placed before the first timing point.', time: objs[0].time, objectIds: [objs[0].id] });
  }
  for (let i = 1; i < bm.timingPoints.length; i++) {
    const a = bm.timingPoints[i - 1];
    const b = bm.timingPoints[i];
    if (a.time === b.time && a.uninherited === b.uninherited) add({ severity: 'warning', category: 'Timing', message: 'Duplicate timing points at the same time.', time: b.time });
  }
  for (const tp of bm.timingPoints) {
    if (tp.uninherited && !(tp.beatLength > 0)) add({ severity: 'error', category: 'Timing', message: 'Timing point has an invalid BPM.', time: tp.time });
    if (tp.volume < 5) add({ severity: 'warning', category: 'Timing', message: `Timing point volume is very low (${tp.volume}%).`, time: tp.time });
  }

  // Compose
  if (objs.length === 0) add({ severity: 'error', category: 'Compose', message: 'This difficulty has no hit objects.' });
  const r = circleRadius(bm.difficulty.circleSize);
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (reds.length) {
      if (snapDivisorOf(bm, o.time) === 0) add({ severity: 'warning', category: 'Compose', message: `Object is not snapped (${offSnap(bm, o.time)}).`, time: o.time, objectIds: [o.id] });
      const end = objectEndTime(bm, o);
      if (o.kind !== 'circle' && snapDivisorOf(bm, end) === 0) {
        add({ severity: 'warning', category: 'Compose', message: `${o.kind === 'slider' ? 'Slider end' : o.kind === 'spinner' ? 'Spinner end' : 'Hold end'} is not snapped (${offSnap(bm, end)}).`, time: end, objectIds: [o.id] });
      }
    }
    const next = objs[i + 1];
    if (next && mode !== 3) {
      if (Math.abs(next.time - o.time) < 1) add({ severity: 'error', category: 'Compose', message: 'Two objects are placed at the same time.', time: o.time, objectIds: [o.id, next.id] });
      else if (next.time < objectEndTime(bm, o) - 1) add({ severity: 'error', category: 'Compose', message: 'Object starts before the previous one ends.', time: next.time, objectIds: [o.id, next.id] });
    }
    if (mode === 0 && o.kind !== 'spinner') {
      if (o.x - r < -64 || o.x + r > 576 || o.y - r < -48 + 16 || o.y + r > 432) add({ severity: 'warning', category: 'Compose', message: 'Object is partially off-screen.', time: o.time, objectIds: [o.id] });
      else if (o.x < 0 || o.x > 512 || o.y < 0 || o.y > 384) add({ severity: 'info', category: 'Compose', message: 'Object is outside the playfield area.', time: o.time, objectIds: [o.id] });
    }
    if (o.kind === 'slider') {
      const path = getSliderPath(o);
      if (o.length <= 0 || path.length <= 0) add({ severity: 'error', category: 'Compose', message: 'Slider has zero length.', time: o.time, objectIds: [o.id] });
      if (mode === 0) {
        for (const p of path.points) {
          if (p.x - r < -64 || p.x + r > 576 || p.y - r < -32 || p.y + r > 432) {
            add({ severity: 'warning', category: 'Compose', message: 'Slider body goes off-screen.', time: o.time, objectIds: [o.id] });
            break;
          }
        }
      }
    }
    if (o.kind === 'spinner') {
      const beat = redLineAt(bm, o.time).beatLength;
      if (o.endTime - o.time < Math.min(beat, 500)) add({ severity: 'warning', category: 'Compose', message: 'Spinner is very short.', time: o.time, objectIds: [o.id] });
    }
  }

  if (mode === 0) {
    let combo = 0;
    for (const o of objs) {
      combo = o.newCombo || o.kind === 'spinner' ? 1 : combo + 1;
      if (combo === 25) add({ severity: 'info', category: 'Compose', message: 'Combo is longer than 24 objects.', time: o.time, objectIds: [o.id] });
    }
  }

  if (mode === 3) {
    const keys = Math.round(bm.difficulty.circleSize);
    const busy = new Map<number, HitObject>();
    for (const o of objs) {
      const c = maniaColumn(o.x, keys);
      const prev = busy.get(c);
      if (prev && objectEndTime(bm, prev) + 1 > o.time) add({ severity: 'error', category: 'Compose', message: `Overlapping notes in column ${c + 1}.`, time: o.time, objectIds: [prev.id, o.id] });
      busy.set(c, o);
    }
  }

  // Design
  for (const br of bm.events.breaks) {
    if (br.end - br.start < 650) add({ severity: 'warning', category: 'Design', message: 'Break is shorter than 650ms.', time: br.start });
    if (objs.some((o) => o.time > br.start && o.time < br.end)) add({ severity: 'error', category: 'Design', message: 'Objects are placed inside a break.', time: br.start });
  }
  if (!bm.events.background) add({ severity: 'warning', category: 'Design', message: 'No background image is set.' });
  else if (!findFile(project, bm.events.background.filename)) add({ severity: 'error', category: 'Design', message: `Background "${bm.events.background.filename}" is missing from the folder.` });
  if (bm.colours.combo.length === 1) add({ severity: 'warning', category: 'Design', message: 'Only one combo colour is defined.' });

  // Metadata / meta
  const m = bm.metadata;
  if (!m.title) add({ severity: 'error', category: 'Metadata', message: 'Romanised title is empty.' });
  if (!m.artist) add({ severity: 'error', category: 'Metadata', message: 'Romanised artist is empty.' });
  if (!m.creator) add({ severity: 'error', category: 'Metadata', message: 'Creator is empty.' });
  if (!m.version) add({ severity: 'error', category: 'Metadata', message: 'Difficulty name is empty.' });
  if (/[^\x20-\x7e]/.test(m.title + m.artist)) add({ severity: 'error', category: 'Metadata', message: 'Romanised fields contain non-ASCII characters.' });
  if (!findFile(project, bm.general.audioFilename)) add({ severity: 'error', category: 'Meta', message: `Audio file "${bm.general.audioFilename}" is missing.` });
  if (bm.general.previewTime < 0) add({ severity: 'warning', category: 'Meta', message: 'Preview point is not set.' });
  for (const d of project.difficulties) {
    const o = d.beatmap.metadata;
    if (d.beatmap === bm) continue;
    if (o.title !== m.title || o.artist !== m.artist || o.source !== m.source || o.tags !== m.tags) {
      add({ severity: 'warning', category: 'Metadata', message: `Metadata differs from difficulty "${o.version}".` });
    }
  }

  return issues.sort((a, b) => (a.time ?? -1) - (b.time ?? -1));
}

function offSnap(bm: Beatmap, time: number): string {
  const red = redLineAt(bm, time);
  const step = red.beatLength / 16;
  const nearest = red.time + Math.round((time - red.time) / step) * step;
  const diff = Math.round(time - nearest);
  return `${diff > 0 ? '+' : ''}${diff}ms from 1/16 at ${formatTimestamp(nearest)}`;
}
