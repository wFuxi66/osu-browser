// Slider path approximation, ported from osu-framework's PathApproximator and osu!'s SliderPath.
import type { CurveType, Slider, Vec2 } from './types';

const BEZIER_TOLERANCE = 0.25;
const CIRCULAR_ARC_TOLERANCE = 0.1;
const CATMULL_DETAIL = 50;

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const lenSq = (a: Vec2) => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const eq = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

function bezierIsFlatEnough(points: Vec2[]): boolean {
  for (let i = 1; i < points.length - 1; i++) {
    const v = sub(add(points[i - 1], points[i + 1]), mul(points[i], 2));
    if (lenSq(v) > BEZIER_TOLERANCE * BEZIER_TOLERANCE * 4) return false;
  }
  return true;
}

function bezierSubdivide(points: Vec2[], l: Vec2[], r: Vec2[]) {
  const count = points.length;
  const mid = points.slice();
  for (let i = 0; i < count; i++) {
    l[i] = mid[0];
    r[count - i - 1] = mid[count - i - 1];
    for (let j = 0; j < count - i - 1; j++) mid[j] = mul(add(mid[j], mid[j + 1]), 0.5);
  }
}

function bezierApproximate(points: Vec2[], output: Vec2[]) {
  const count = points.length;
  const l: Vec2[] = new Array(count * 2 - 1);
  const r: Vec2[] = new Array(count);
  bezierSubdivide(points, l, r);
  for (let i = 0; i < count - 1; i++) l[count + i] = r[i + 1];
  output.push(points[0]);
  for (let i = 1; i < count - 1; i++) {
    const index = 2 * i;
    const p = mul(add(add(l[index - 1], mul(l[index], 2)), l[index + 1]), 0.25);
    output.push(p);
  }
}

export function approximateBezier(controlPoints: Vec2[]): Vec2[] {
  const output: Vec2[] = [];
  const count = controlPoints.length;
  if (count === 0) return output;
  const toFlatten: Vec2[][] = [controlPoints.slice()];
  while (toFlatten.length > 0) {
    const parent = toFlatten.pop()!;
    if (bezierIsFlatEnough(parent)) {
      bezierApproximate(parent, output);
      continue;
    }
    const left: Vec2[] = new Array(count);
    const right: Vec2[] = new Array(count);
    bezierSubdivide(parent, left, right);
    toFlatten.push(right, left);
  }
  output.push(controlPoints[count - 1]);
  return output;
}

function catmullFindPoint(v1: Vec2, v2: Vec2, v3: Vec2, v4: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t * t2;
  return {
    x: 0.5 * (2 * v2.x + (-v1.x + v3.x) * t + (2 * v1.x - 5 * v2.x + 4 * v3.x - v4.x) * t2 + (-v1.x + 3 * v2.x - 3 * v3.x + v4.x) * t3),
    y: 0.5 * (2 * v2.y + (-v1.y + v3.y) * t + (2 * v1.y - 5 * v2.y + 4 * v3.y - v4.y) * t2 + (-v1.y + 3 * v2.y - 3 * v3.y + v4.y) * t3),
  };
}

export function approximateCatmull(points: Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const v1 = i > 0 ? points[i - 1] : points[i];
    const v2 = points[i];
    const v3 = i < n - 1 ? points[i + 1] : sub(mul(v2, 2), v1);
    const v4 = i < n - 2 ? points[i + 2] : sub(mul(v3, 2), v2);
    for (let c = 0; c < CATMULL_DETAIL; c++) {
      result.push(catmullFindPoint(v1, v2, v3, v4, c / CATMULL_DETAIL));
      result.push(catmullFindPoint(v1, v2, v3, v4, (c + 1) / CATMULL_DETAIL));
    }
  }
  return result;
}

export interface CircularArc {
  centre: Vec2;
  radius: number;
  thetaStart: number;
  thetaRange: number;
  direction: number;
}

export function circularArcProperties(points: Vec2[]): CircularArc | null {
  const [a, b, c] = points;
  if (Math.abs((b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y)) < 1e-3) return null;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const aSq = lenSq(a);
  const bSq = lenSq(b);
  const cSq = lenSq(c);
  const centre = {
    x: (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d,
    y: (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d,
  };
  const dA = sub(a, centre);
  const dC = sub(c, centre);
  const radius = Math.hypot(dA.x, dA.y);
  const thetaStart = Math.atan2(dA.y, dA.x);
  let thetaEnd = Math.atan2(dC.y, dC.x);
  while (thetaEnd < thetaStart) thetaEnd += 2 * Math.PI;
  let direction = 1;
  let thetaRange = thetaEnd - thetaStart;
  const ortho = { x: c.y - a.y, y: -(c.x - a.x) };
  if (ortho.x * (b.x - a.x) + ortho.y * (b.y - a.y) < 0) {
    direction = -1;
    thetaRange = 2 * Math.PI - thetaRange;
  }
  return { centre, radius, thetaStart, thetaRange, direction };
}

export function approximateCircularArc(points: Vec2[]): Vec2[] {
  const arc = circularArcProperties(points);
  if (!arc) return approximateBezier(points);
  const { centre, radius, thetaStart, thetaRange, direction } = arc;
  const amount =
    2 * radius <= CIRCULAR_ARC_TOLERANCE
      ? 2
      : Math.max(2, Math.ceil(thetaRange / (2 * Math.acos(1 - CIRCULAR_ARC_TOLERANCE / radius))));
  const out: Vec2[] = [];
  for (let i = 0; i < amount; i++) {
    const theta = thetaStart + (direction * i * thetaRange) / (amount - 1);
    out.push({ x: centre.x + Math.cos(theta) * radius, y: centre.y + Math.sin(theta) * radius });
  }
  return out;
}

function approximateSegment(type: CurveType, pts: Vec2[], isOnlySegment: boolean): Vec2[] {
  switch (type) {
    case 'L':
      return pts;
    case 'P':
      if (isOnlySegment && pts.length === 3) return approximateCircularArc(pts);
      return approximateBezier(pts);
    case 'C':
      return approximateCatmull(pts);
    default:
      return approximateBezier(pts);
  }
}

/** Computes the full (unclipped) polyline for a set of control vertices. */
export function computeRawPath(type: CurveType, vertices: Vec2[]): Vec2[] {
  if (vertices.length < 2) return vertices.slice();
  // Perfect circles are only valid with exactly 3 points.
  if (type === 'P' && vertices.length !== 3) type = 'B';
  const path: Vec2[] = [];
  const segments: Vec2[][] = [];
  if (type === 'L') {
    for (let i = 0; i < vertices.length - 1; i++) segments.push([vertices[i], vertices[i + 1]]);
  } else if (type === 'C') {
    segments.push(vertices);
  } else {
    let start = 0;
    for (let i = 1; i < vertices.length; i++) {
      const isAnchor = i < vertices.length - 1 && eq(vertices[i], vertices[i + 1]);
      if (isAnchor || i === vertices.length - 1) {
        segments.push(vertices.slice(start, i + 1));
        start = isAnchor ? i + 1 : i;
        if (isAnchor) i++;
      }
    }
  }
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const sub = approximateSegment(type, seg, segments.length === 1);
    for (const p of sub) {
      if (path.length === 0 || !eq(path[path.length - 1], p)) path.push(p);
    }
  }
  if (path.length === 1) path.push({ ...path[0] });
  return path;
}

export class SliderPath {
  readonly points: Vec2[];
  readonly cumulative: number[];
  readonly length: number;
  readonly rawLength: number;

  constructor(type: CurveType, vertices: Vec2[], expectedLength?: number) {
    const path = computeRawPath(type, vertices);
    const cumulative: number[] = [0];
    let l = 0;
    for (let i = 1; i < path.length; i++) {
      l += dist(path[i - 1], path[i]);
      cumulative.push(l);
    }
    this.rawLength = l;
    if (expectedLength !== undefined && expectedLength > 0 && Math.abs(expectedLength - l) > 1e-6 && path.length >= 2) {
      const n = vertices.length;
      const lastTwoEqual = n >= 2 && eq(vertices[n - 1], vertices[n - 2]);
      if (!(lastTwoEqual && expectedLength > l)) {
        cumulative.pop();
        let end = path.length - 1;
        if (l > expectedLength) {
          while (cumulative.length > 0 && cumulative[cumulative.length - 1] >= expectedLength) {
            cumulative.pop();
            path.splice(end--, 1);
          }
        }
        if (end <= 0) {
          path.length = 1;
          path.push({ ...path[0] });
          this.points = path;
          this.cumulative = [0, 0];
          this.length = 0;
          return;
        }
        const segLen = dist(path[end], path[end - 1]);
        const dir = segLen > 0 ? mul(sub(path[end], path[end - 1]), 1 / segLen) : { x: 0, y: 0 };
        path[end] = add(path[end - 1], mul(dir, expectedLength - cumulative[cumulative.length - 1]));
        cumulative.push(expectedLength);
        l = expectedLength;
      }
    }
    this.points = path;
    this.cumulative = cumulative;
    this.length = l;
  }

  /** Position at a progress of 0..1 along the (clipped) path. */
  positionAt(progress: number): Vec2 {
    const d = Math.min(Math.max(progress, 0), 1) * this.length;
    const c = this.cumulative;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    if (lo <= 0) return { ...this.points[0] };
    if (lo >= this.points.length) return { ...this.points[this.points.length - 1] };
    const p0 = this.points[lo - 1];
    const p1 = this.points[lo];
    const d0 = c[lo - 1];
    const d1 = c[lo];
    if (d1 - d0 < 1e-9) return { ...p0 };
    return add(p0, mul(sub(p1, p0), (d - d0) / (d1 - d0)));
  }

  /** Sub-polyline between two progress values, used for drawing snaking sliders. */
  pathBetween(p0: number, p1: number): Vec2[] {
    const d0 = p0 * this.length;
    const d1 = p1 * this.length;
    const out: Vec2[] = [this.positionAt(p0)];
    for (let i = 0; i < this.points.length; i++) {
      if (this.cumulative[i] > d0 && this.cumulative[i] < d1) out.push(this.points[i]);
    }
    out.push(this.positionAt(p1));
    return out;
  }
}

const cache = new WeakMap<Slider, { key: string; path: SliderPath }>();

function sliderKey(s: Slider): string {
  let k = `${s.curveType}${s.x},${s.y},${s.length}`;
  for (const p of s.points) k += `|${p.x},${p.y}`;
  return k;
}

export function sliderVertices(s: Slider): Vec2[] {
  return [{ x: s.x, y: s.y }, ...s.points];
}

export function getSliderPath(s: Slider): SliderPath {
  const key = sliderKey(s);
  const hit = cache.get(s);
  if (hit && hit.key === key) return hit.path;
  const path = new SliderPath(s.curveType, sliderVertices(s), s.length);
  cache.set(s, { key, path });
  return path;
}

/** Position of a slider at a given span progress (0..slides), handling repeats. */
export function sliderPositionAtSpan(s: Slider, spanProgress: number): Vec2 {
  const span = Math.floor(spanProgress);
  let p = spanProgress - span;
  if (span % 2 === 1) p = 1 - p;
  if (spanProgress >= s.slides) p = s.slides % 2 === 0 ? 0 : 1;
  return getSliderPath(s).positionAt(p);
}

export function sliderEndPosition(s: Slider): Vec2 {
  return getSliderPath(s).positionAt(s.slides % 2 === 0 ? 0 : 1);
}

/** Picks the curve type osu! stable auto-assigns while placing a slider. */
export function autoCurveType(vertices: Vec2[]): CurveType {
  if (vertices.length <= 2) return 'L';
  if (vertices.length === 3 && circularArcProperties(vertices)) return 'P';
  return 'B';
}
