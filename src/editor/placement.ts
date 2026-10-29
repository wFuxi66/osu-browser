// Placement and slider-length helpers (pure, so the editor and the tests share them).
import { autoCurveType, getSliderPath } from '../osu/curves';
import { objectEndTime, stepTick, svAt } from '../osu/timing';
import type { Beatmap, HitObject, HitSample, Slider, Vec2 } from '../osu/types';

export interface SliderShape {
  id: number;
  /** Head time, snapped like stable. */
  time: number;
  /** Head first, then the control points; consecutive duplicates make a red anchor. */
  vertices: Vec2[];
  /** 1 + the repeats added while placing. */
  slides: number;
  newCombo: boolean;
  hitSound: number;
  sample: HitSample;
}

/**
 * The slider a placement makes. Unlike osu!stable's recalculate command, a freshly placed slider keeps exactly the
 * length of the path that was drawn: its end is often between two beat-divisor ticks, which AiMod flags.
 * Returns null when the path is shorter than a pixel (nothing to play).
 */
export function sliderFromShape(p: SliderShape): Slider | null {
  const verts = p.vertices;
  if (verts.length < 2) return null;
  const slides = Math.max(1, Math.round(p.slides));
  const edgeSets = Array.from({ length: slides + 1 }, () => ({ normal: 0 as const, addition: 0 as const }));
  const s: Slider = {
    id: p.id,
    kind: 'slider',
    x: verts[0].x,
    y: verts[0].y,
    time: p.time,
    newCombo: p.newCombo,
    comboSkip: 0,
    hitSound: p.hitSound,
    sample: p.sample,
    curveType: autoCurveType(verts),
    points: verts.slice(1),
    slides,
    length: 0,
    edgeSounds: Array.from({ length: slides + 1 }, () => p.hitSound),
    edgeSets,
  };
  s.length = getSliderPath({ ...s, length: 0 }).rawLength;
  return s.length >= 1 ? s : null;
}

/**
 * Where the playhead moves on after placing `o`, like stable: a circle to the next beat-divisor tick (`ticks` of
 * them), a slider or a spinner to its own end. Null when the object doesn't move the playhead (a mania hold).
 */
export function nextPlacementTime(bm: Beatmap, o: HitObject, divisor: number, ticks = 1): number | null {
  if (o.kind === 'hold') return null;
  if (o.kind === 'circle') {
    let t = o.time;
    for (let i = 0; i < Math.max(1, Math.round(ticks)); i++) t = stepTick(bm, t, divisor, 1);
    return t;
  }
  return objectEndTime(bm, o);
}

/**
 * Clamp a slider's length to a whole number of divisor ticks that fits its path. This is stable's "Recalculate
 * slider lengths", the timeline's tail drag and a resnap after timing changes — never a fresh placement, which keeps
 * the length the mapper drew (an unsnapped end, which AiMod then flags).
 */
export function snapSliderLength(bm: Beatmap, s: Slider, divisor: number) {
  const raw = getSliderPath({ ...s, length: 0 }).rawLength;
  const ppb = bm.difficulty.sliderMultiplier * 100 * svAt(bm, s.time);
  const tickLen = ppb / divisor;
  if (tickLen <= 0) return;
  const ticks = Math.max(1, Math.floor((Math.min(s.length || raw, raw) + 0.01) / tickLen));
  s.length = Number((ticks * tickLen).toFixed(6));
}
