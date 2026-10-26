// Slider Completionator and Slider Merger, after the tools of the same names in OliBomby's Mapping Tools
// (reimplemented from how they behave, not ported).
import { circularArcProperties, dist, getSliderPath, SliderPath, sliderVertices, type CircularArc } from '../osu/curves';
import { beatLengthAt, controlPointAt, redLineAt, sortTimingPoints, svAt } from '../osu/timing';
import type { Beatmap, CurveType, HitObject, Slider, Vec2 } from '../osu/types';

const MIN_SV = 0.1;
const MAX_SV = 10;

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
const round = (p: Vec2): Vec2 => ({ x: Math.round(p.x), y: Math.round(p.y) });

// ------------------------------------------------------------------ paths as Bézier segments

/** A slider path as consecutive Bézier segments; each one starts where the previous one ends. */
export type Segments = Vec2[][];

/** Cubic Béziers for a circular arc, in pieces of at most 90° (off by well under a pixel). */
function arcToBezier(arc: CircularArc): Segments {
  const { centre, radius, thetaStart, thetaRange, direction } = arc;
  const n = Math.max(1, Math.ceil(thetaRange / (Math.PI / 2) - 1e-9));
  const step = thetaRange / n;
  const k = (4 / 3) * Math.tan(step / 4) * radius;
  const at = (t: number): Vec2 => ({ x: centre.x + Math.cos(t) * radius, y: centre.y + Math.sin(t) * radius });
  const tangent = (t: number): Vec2 => ({ x: -Math.sin(t) * direction * k, y: Math.cos(t) * direction * k });
  const segs: Segments = [];
  for (let i = 0; i < n; i++) {
    const a = thetaStart + direction * step * i;
    const b = a + direction * step;
    const p0 = at(a);
    const p3 = at(b);
    const ta = tangent(a);
    const tb = tangent(b);
    segs.push([p0, { x: p0.x + ta.x, y: p0.y + ta.y }, { x: p3.x - tb.x, y: p3.y - tb.y }, p3]);
  }
  return segs;
}

/** The exact cubic Béziers of osu!'s Catmull-Rom curve. */
function catmullToBezier(p: Vec2[]): Segments {
  const segs: Segments = [];
  const n = p.length;
  for (let i = 0; i < n - 1; i++) {
    const v1 = i > 0 ? p[i - 1] : p[i];
    const v2 = p[i];
    const v3 = p[i + 1];
    const v4 = i < n - 2 ? p[i + 2] : { x: 2 * v3.x - v2.x, y: 2 * v3.y - v2.y };
    segs.push([v2, { x: v2.x + (v3.x - v1.x) / 6, y: v2.y + (v3.y - v1.y) / 6 }, { x: v3.x - (v4.x - v2.x) / 6, y: v3.y - (v4.y - v2.y) / 6 }, v3]);
  }
  return segs;
}

/** The whole control path (ignoring the slider's length) as Bézier segments, split where osu! splits it. */
export function bezierSegments(type: CurveType, verts: Vec2[]): Segments {
  if (verts.length < 2) return [];
  if (type === 'L') return verts.slice(1).map((p, i) => [verts[i], p]);
  if (type === 'C') return catmullToBezier(verts);
  if (type === 'P' && verts.length === 3) {
    const arc = circularArcProperties(verts);
    if (arc) return arcToBezier(arc);
  }
  // Bézier: consecutive duplicates are red anchors.
  const segs: Segments = [];
  let cur = [verts[0]];
  for (let i = 1; i < verts.length; i++) {
    cur.push(verts[i]);
    if (i < verts.length - 1 && same(verts[i], verts[i + 1])) {
      segs.push(cur);
      cur = [verts[i]];
      i++;
    }
  }
  segs.push(cur);
  return segs.filter((s) => s.length >= 2);
}

function segmentLength(seg: Vec2[]): number {
  return new SliderPath('B', seg).rawLength;
}

function bezierAt(seg: Vec2[], t: number): Vec2 {
  let pts = seg;
  while (pts.length > 1) pts = pts.slice(1).map((p, i) => lerp(pts[i], p, t));
  return pts[0];
}

/** The part of a Bézier segment from its start to `t` (de Casteljau). */
function bezierHead(seg: Vec2[], t: number): Vec2[] {
  const out: Vec2[] = [];
  let pts = seg;
  while (pts.length > 0) {
    out.push(pts[0]);
    pts = pts.slice(1).map((p, i) => lerp(pts[i], p, t));
  }
  return out;
}

/** A segment cut to `length` along it. */
function cutSegment(seg: Vec2[], length: number, total: number): Vec2[] {
  if (seg.length === 2) return [seg[0], lerp(seg[0], seg[1], total > 0 ? length / total : 0)];
  const N = 256;
  const cum = [0];
  let prev = seg[0];
  for (let i = 1; i <= N; i++) {
    const p = bezierAt(seg, i / N);
    cum.push(cum[i - 1] + dist(prev, p));
    prev = p;
  }
  const target = (length / total) * cum[N];
  let i = 1;
  while (i < N && cum[i] < target) i++;
  const span = cum[i] - cum[i - 1];
  const t = (i - 1 + (span > 0 ? (target - cum[i - 1]) / span : 0)) / N;
  return bezierHead(seg, t);
}

/** Segments cut or extended so they're `length` long (longer goes on in a straight line, like osu!). */
function fitSegments(segs: Segments, length: number, extendTo?: Vec2): Segments {
  const out: Segments = [];
  let left = length;
  for (const seg of segs) {
    const l = segmentLength(seg);
    if (left >= l - 0.01) {
      out.push(seg);
      left -= l;
      if (left <= 0.01) return out;
      continue;
    }
    out.push(cutSegment(seg, left, l));
    return out;
  }
  const last = out[out.length - 1]?.at(-1);
  if (last && extendTo && dist(last, extendTo) > 0.01) out.push([last, extendTo]);
  return out;
}

/** The slider's path as it's drawn: cut at (or extended to) its length. */
export function drawnSegments(s: Slider): Segments {
  return fitSegments(bezierSegments(s.curveType, sliderVertices(s)), s.length, getSliderPath(s).positionAt(1));
}

/**
 * Integer control points (what the .osu stores) for a list of segments: a single curve type, red anchors between
 * Bézier segments, and 'L' when every piece is straight.
 */
export function segmentsToShape(segs: Segments, linear: boolean): { curveType: CurveType; vertices: Vec2[] } {
  const rounded: Segments = [];
  for (const seg of segs) {
    const start = rounded.length ? rounded[rounded.length - 1].at(-1)! : round(seg[0]);
    const pts = [start];
    // A repeated point inside a segment would read as a red anchor.
    for (const p of seg.slice(1).map(round)) if (!same(p, pts[pts.length - 1])) pts.push(p);
    if (pts.length >= 2) rounded.push(pts);
  }
  if (!rounded.length) {
    const p = round(segs[0]?.[0] ?? { x: 0, y: 0 });
    return { curveType: 'L', vertices: [p, p] };
  }
  const straight = rounded.every((s) => s.length === 2);
  if (straight && (linear || rounded.length === 1)) return { curveType: 'L', vertices: [rounded[0][0], ...rounded.map((s) => s[1])] };
  const vertices = [...rounded[0]];
  for (const seg of rounded.slice(1)) vertices.push(...seg);
  return { curveType: 'B', vertices };
}

function applyShape(s: Slider, shape: { curveType: CurveType; vertices: Vec2[] }) {
  s.curveType = shape.curveType;
  s.x = shape.vertices[0].x;
  s.y = shape.vertices[0].y;
  s.points = shape.vertices.slice(1);
  // A hair short of the full path, so float noise never extends it.
  s.length = Math.floor(new SliderPath(shape.curveType, shape.vertices).rawLength * 1000) / 1000;
}

// ------------------------------------------------------------------ slider velocity

/** The beatLength of the green line in effect (-100 = 1×), for putting an SV back exactly as it was. */
function svBeatLengthAt(bm: Beatmap, time: number): number {
  let bl = -100;
  for (const tp of bm.timingPoints) {
    if (tp.time > time + 0.5) break;
    bl = !tp.uninherited && tp.beatLength < 0 ? tp.beatLength : -100;
  }
  return bl;
}

/** Puts a green line with this SV at `time`, keeping the volume, sample set and kiai in effect there. */
function setSvLine(bm: Beatmap, time: number, beatLength: number) {
  const existing = bm.timingPoints.find((tp) => !tp.uninherited && Math.abs(tp.time - time) <= 0.5);
  if (existing) {
    existing.beatLength = beatLength;
    return;
  }
  const cur = controlPointAt(bm, time);
  bm.timingPoints.push({
    time,
    beatLength,
    meter: redLineAt(bm, time).meter,
    sampleSet: cur.sampleSet,
    sampleIndex: cur.sampleIndex,
    volume: cur.volume,
    uninherited: false,
    kiai: cur.kiai,
    omitFirstBarLine: false,
  });
  sortTimingPoints(bm.timingPoints);
}

/**
 * Gives these sliders their new SV with green lines, and puts every other slider's SV back where a new line would
 * have changed it, so nothing else in the map speeds up or slows down.
 */
function applySliderVelocities(bm: Beatmap, targets: Map<Slider, number>) {
  const sliders = bm.hitObjects.filter((o): o is Slider => o.kind === 'slider');
  const want = new Map(sliders.map((s) => [s, targets.has(s) ? -100 / targets.get(s)! : svBeatLengthAt(bm, s.time)]));
  for (const s of sliders) {
    const bl = want.get(s)!;
    if (Math.abs(svBeatLengthAt(bm, s.time) - bl) > 1e-9) setSvLine(bm, s.time, bl);
  }
}

// ------------------------------------------------------------------ Slider Completionator

export type FreeVariable = 'velocity' | 'length' | 'duration';

export interface CompletionOptions {
  /** The value worked out from the other two. */
  free: FreeVariable;
  /** Whole slider (all repeats) in beats of its red line, or null to keep it. */
  beats: number | null;
  /** Where the slider should end in ms; takes the place of `beats`. */
  endTime: number | null;
  /** Length as a fraction of the drawn path (1 = up to the last anchor), or null to keep it. */
  completion: number | null;
  /** SV multiplier, or null to keep it. */
  sv: number | null;
  /** Cut the path at the new length, or extend it in a straight line, so the slider ends on its last anchor. */
  moveAnchors: boolean;
}

export interface CompletionPlan {
  slider: Slider;
  length: number;
  sv: number;
  oldSv: number;
  /** Duration of one span (head to tail) in ms, what a calculated SV is worked out from. */
  span: number;
  error?: string;
}

/** What the Completionator would do to each slider, without changing anything. */
export function planCompletion(bm: Beatmap, sliders: Slider[], o: CompletionOptions): CompletionPlan[] {
  const ppb1 = bm.difficulty.sliderMultiplier * 100;
  return sliders.map((s) => {
    const beat = beatLengthAt(bm, s.time);
    const oldSv = svAt(bm, s.time);
    const fullLength = new SliderPath(s.curveType, sliderVertices(s)).rawLength;
    const oldSpan = (s.length / (ppb1 * oldSv)) * beat;
    const total = o.endTime !== null ? o.endTime - s.time : o.beats !== null ? o.beats * beat : oldSpan * s.slides;
    let span = total / s.slides;
    let length = o.completion !== null ? fullLength * o.completion : s.length;
    let sv = o.sv ?? oldSv;
    if (o.free === 'velocity') sv = (length * beat) / (ppb1 * span);
    else if (o.free === 'length') length = (span * ppb1 * sv) / beat;
    else span = (length / (ppb1 * sv)) * beat;
    const plan: CompletionPlan = { slider: s, length, sv, oldSv, span };
    if (!(span > 0)) plan.error = 'it would end before it starts';
    else if (!(length > 0) || !Number.isFinite(length)) plan.error = 'its length would be zero';
    else if (!Number.isFinite(sv) || sv < MIN_SV - 1e-6 || sv > MAX_SV + 1e-6) plan.error = `it would need ${sv.toFixed(2)}× SV (osu! allows ${MIN_SV}× to ${MAX_SV}×)`;
    return plan;
  });
}

/** Applies a plan's lengths and SVs (skipping sliders with an error). Returns how many sliders changed. */
export function applyCompletion(bm: Beatmap, plans: CompletionPlan[], o: CompletionOptions): number {
  const ppb1 = bm.difficulty.sliderMultiplier * 100;
  const targets = new Map<Slider, number>();
  for (const p of plans) {
    if (p.error) continue;
    const s = p.slider;
    let sv = p.sv;
    if (o.moveAnchors) {
      const segs = bezierSegments(s.curveType, sliderVertices(s));
      const end = new SliderPath(s.curveType, sliderVertices(s), p.length).positionAt(1);
      applyShape(s, segmentsToShape(fitSegments(segs, p.length, end), s.curveType === 'L'));
      // Whole-pixel anchors move the end a little: a calculated SV follows the length the path really has.
      if (o.free === 'velocity') sv = Math.min(MAX_SV, Math.max(MIN_SV, (s.length * beatLengthAt(bm, s.time)) / (ppb1 * p.span)));
    } else {
      s.length = Number(p.length.toFixed(6));
    }
    if (Math.abs(sv - p.oldSv) > 1e-9) targets.set(s, sv);
  }
  applySliderVelocities(bm, targets);
  return plans.filter((p) => !p.error).length;
}

// ------------------------------------------------------------------ Slider Merger

export interface MergeOptions {
  /** Largest gap (osu!pixels) between one object's end and the next one's start that still merges. */
  leniency: number;
  /** 'move' shifts the next slider onto the previous one's end; 'linear' joins them with a straight line. */
  connection: 'move' | 'linear';
  /** Straight-only results stay a linear slider instead of a Bézier with red anchors. */
  linearOnLinear: boolean;
}

const endOf = (o: HitObject): Vec2 => (o.kind === 'slider' ? getSliderPath(o).positionAt(1) : { x: o.x, y: o.y });
const mergeable = (o: HitObject) => o.kind === 'circle' || o.kind === 'slider';

/** One slider from two objects, or null when there's no path between them (two circles on the same spot). */
function mergeTwo(a: HitObject, b: HitObject, o: MergeOptions): Slider | null {
  const head = { x: a.x, y: a.y };
  const segs: Segments = a.kind === 'slider' ? drawnSegments(a) : [];
  const end = segs.length ? segs[segs.length - 1].at(-1)! : head;
  let next: Segments = b.kind === 'slider' ? drawnSegments(b) : [];
  if (a.kind === 'slider' && b.kind === 'slider' && o.connection === 'move') {
    const dx = end.x - b.x;
    const dy = end.y - b.y;
    next = next.map((seg) => seg.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  } else if (dist(end, b) > 0) {
    segs.push([end, { x: b.x, y: b.y }]);
  }
  segs.push(...next);
  if (!segs.length) return null;

  const headSound = a.kind === 'slider' ? a.edgeSounds[0] ?? 0 : a.hitSound;
  const headSet = a.kind === 'slider' ? a.edgeSets[0] ?? { normal: 0, addition: 0 } : { normal: a.sample.normalSet, addition: a.sample.additionSet };
  const tailSound = b.kind === 'slider' ? b.edgeSounds[b.edgeSounds.length - 1] ?? 0 : b.hitSound;
  const tailSet = b.kind === 'slider'
    ? b.edgeSets[b.edgeSets.length - 1] ?? { normal: 0, addition: 0 }
    : { normal: b.sample.normalSet, addition: b.sample.additionSet };
  const merged: Slider = {
    id: a.id,
    kind: 'slider',
    x: a.x,
    y: a.y,
    time: a.time,
    newCombo: a.newCombo,
    comboSkip: a.comboSkip,
    hitSound: a.kind === 'slider' ? a.hitSound : 0,
    sample: { ...a.sample },
    curveType: 'B',
    points: [],
    slides: 1,
    length: 0,
    edgeSounds: [headSound, tailSound],
    edgeSets: [{ ...headSet }, { ...tailSet }],
  };
  applyShape(merged, segmentsToShape(segs, o.linearOnLinear));
  return merged;
}

export interface MergePlan {
  /** The merged sliders, each with the id of the first object it was made from. */
  merged: Slider[];
  /** Ids of the objects merged into an earlier one. */
  removed: Set<number>;
}

/**
 * Joins neighbouring circles and sliders of `objs` (in time order) into sliders where one ends within the leniency
 * of where the next starts. The merged slider keeps the first object's time, id, combo and samples, with the
 * first object's head sound and the last one's tail sound. Changes nothing: `applyMerge` does.
 */
export function planMerge(objs: HitObject[], o: MergeOptions): MergePlan {
  const merged = new Map<number, Slider>();
  const removed = new Set<number>();
  let cur: HitObject | null = null;
  for (const next of objs) {
    const m: Slider | null = cur && mergeable(cur) && mergeable(next) && dist(endOf(cur), next) <= o.leniency ? mergeTwo(cur, next, o) : null;
    if (m) {
      removed.add(next.id);
      merged.set(m.id, m);
      cur = m;
    } else {
      cur = next;
    }
  }
  return { merged: [...merged.values()], removed };
}

export function applyMerge(bm: Beatmap, plan: MergePlan) {
  const byId = new Map(plan.merged.map((s) => [s.id, s]));
  bm.hitObjects = bm.hitObjects.filter((x) => !plan.removed.has(x.id)).map((x) => byId.get(x.id) ?? x);
}
