// Grid and distance snapping for placement and dragging.
import { music } from '../../audio/music';
import { objectEndTime, beatLengthAt, svAt } from '../../osu/timing';
import type { HitObject, Vec2 } from '../../osu/types';
import { editor, PLAYFIELD_H, PLAYFIELD_W } from '../store';

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export function gridSnapActive(m: Modifiers) {
  return editor.gridSnap !== m.shift;
}

export function distanceSnapActive(m: Modifiers) {
  return editor.distanceSnap !== m.alt;
}

/** The object before `time` that distance snap measures from. */
export function previousObject(time: number, exclude?: Set<number>): HitObject | null {
  const objs = editor.bm.hitObjects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (exclude?.has(o.id)) continue;
    if (o.kind === 'spinner') continue;
    if (o.time < time - 0.5) return o;
  }
  return null;
}

/** Distance (osu!px) that distance snap expects between `from` (ending at fromTime) and an object at `time`. */
export function expectedDistance(fromTime: number, time: number): number {
  const bm = editor.bm;
  const beats = (time - fromTime) / beatLengthAt(bm, time);
  return beats * bm.difficulty.sliderMultiplier * 100 * svAt(bm, time) * bm.editor.distanceSpacing;
}

export function distanceSnapCentre(time: number, exclude?: Set<number>): { centre: Vec2; radius: number } | null {
  const prev = previousObject(time, exclude);
  if (!prev) return null;
  const end = editor.processed.info.get(prev.id);
  const pos = end?.endPos ?? { x: prev.x, y: prev.y };
  const endT = objectEndTime(editor.bm, prev);
  const radius = expectedDistance(endT, time);
  if (radius <= 0) return null;
  return { centre: pos, radius };
}

export function snapPosition(p: Vec2, m: Modifiers, time = editor.snap(music.time), exclude?: Set<number>): Vec2 {
  let out = { ...p };
  if (distanceSnapActive(m)) {
    const ds = distanceSnapCentre(time, exclude);
    if (ds) {
      const dx = p.x - ds.centre.x;
      const dy = p.y - ds.centre.y;
      const d = Math.hypot(dx, dy) || 1;
      out = { x: ds.centre.x + (dx / d) * ds.radius, y: ds.centre.y + (dy / d) * ds.radius };
      return { x: Math.round(out.x), y: Math.round(out.y) };
    }
  }
  if (gridSnapActive(m)) {
    const g = editor.gridSize;
    out = { x: Math.round(out.x / g) * g, y: Math.round(out.y / g) * g };
  }
  return { x: Math.round(out.x), y: Math.round(out.y) };
}

export function clampToPlayfield(p: Vec2): Vec2 {
  return { x: Math.max(0, Math.min(PLAYFIELD_W, p.x)), y: Math.max(0, Math.min(PLAYFIELD_H, p.y)) };
}
