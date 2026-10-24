// lazer's SliderPath and osu-framework's PathApproximator, kept bit-faithful (float32) for difficulty calculation.
// The editor's own curves.ts is close enough for drawing; star ratings need the exact same path lengths and
// positions as lazer, because slider ticks, end positions and stacking all depend on them.
import { add, binarySearch, compareNumbers, dot, equals, f32, length, lengthSq, normalized, scale, sub, vec, ZERO, type V2 } from './vec';

export type PathType = 'L' | 'P' | 'B' | 'C';

export interface ControlPoint {
  pos: V2;
  type: PathType | null;
}

const BEZIER_TOLERANCE = f32(0.25);
const CIRCULAR_ARC_TOLERANCE = f32(0.1);
const CATMULL_DETAIL = 50;
const FLOAT_EPSILON = f32(1e-3);
const DOUBLE_EPSILON = 1e-7;
/** First .osu format version written by lazer (float coordinates, relaxed perfect-curve rules). */
export const FIRST_LAZER_VERSION = 128;

const almostEqualsF = (a: number, b: number) => Math.abs(f32(a - b)) <= FLOAT_EPSILON;
export const almostEquals = (a: number, b: number, eps = DOUBLE_EPSILON) => Math.abs(a - b) <= eps;

// --- PathApproximator ---

function bezierIsFlatEnough(cp: V2[]): boolean {
  const limit = f32(f32(f32(BEZIER_TOLERANCE * BEZIER_TOLERANCE) * 4));
  for (let i = 1; i < cp.length - 1; i++) {
    if (lengthSq(add(sub(cp[i - 1], scale(cp[i], 2)), cp[i + 1])) > limit) return false;
  }
  return true;
}

function bezierSubdivide(cp: V2[], l: V2[], r: V2[], count: number) {
  const mid = cp.slice(0, count);
  for (let i = 0; i < count; i++) {
    l[i] = mid[0];
    r[count - i - 1] = mid[count - i - 1];
    for (let j = 0; j < count - i - 1; j++) mid[j] = { x: f32(f32(mid[j].x + mid[j + 1].x) / 2), y: f32(f32(mid[j].y + mid[j + 1].y) / 2) };
  }
}

function bezierApproximate(cp: V2[], output: V2[], count: number) {
  const l: V2[] = new Array(count * 2 - 1);
  const r: V2[] = new Array(count);
  bezierSubdivide(cp, l, r, count);
  for (let i = 0; i < count - 1; i++) l[count + i] = r[i + 1];
  output.push(cp[0]);
  const quarter = f32(0.25);
  for (let i = 1; i < count - 1; i++) {
    const index = 2 * i;
    output.push(scale(add(add(l[index - 1], scale(l[index], 2)), l[index + 1]), quarter));
  }
}

function bSplineToBezier(controlPoints: V2[], degree: number): V2[][] {
  const pointCount = controlPoints.length - 1;
  const points = controlPoints.slice();
  if (degree === pointCount) return [points];
  const result: V2[][] = [];
  for (let i = 0; i < pointCount - degree; i++) {
    const subBezier: V2[] = new Array(degree + 1);
    subBezier[0] = points[i];
    for (let j = 0; j < degree - 1; j++) {
      subBezier[j + 1] = points[i + 1];
      for (let k = 1; k < degree - j; k++) {
        const l = Math.min(k, pointCount - degree - i);
        const lf = f32(l);
        const n = add(scale(points[i + k], lf), points[i + k + 1]);
        points[i + k] = { x: f32(n.x / (l + 1)), y: f32(n.y / (l + 1)) };
      }
    }
    subBezier[degree] = points[i + 1];
    result.push(subBezier);
  }
  result.push(points.slice(pointCount - degree));
  return result;
}

export function bSplineToPiecewiseLinear(controlPoints: V2[], degree: number): V2[] {
  if (controlPoints.length < 2) return controlPoints.length === 0 ? [] : [controlPoints[0]];
  degree = Math.min(degree, controlPoints.length - 1);
  const output: V2[] = [];
  // The stack is processed in order (C# reverses it), and each subdivision continues with its left half first.
  const toFlatten = bSplineToBezier(controlPoints, degree).reverse();
  while (toFlatten.length > 0) {
    const parent = toFlatten.pop()!;
    if (bezierIsFlatEnough(parent)) {
      bezierApproximate(parent, output, degree + 1);
      continue;
    }
    const left: V2[] = new Array(degree * 2 + 1);
    const right: V2[] = new Array(degree + 1);
    bezierSubdivide(parent, left, right, degree + 1);
    toFlatten.push(right, left.slice(0, degree + 1));
  }
  output.push(controlPoints[controlPoints.length - 1]);
  return output;
}

function catmullFindPoint(v1: V2, v2: V2, v3: V2, v4: V2, t: number): V2 {
  const t2 = f32(t * t);
  const t3 = f32(t * t2);
  const axis = (a: number, b: number, c: number, d: number) => {
    let s = f32(2 * b);
    s = f32(s + f32(f32(-a + c) * t));
    s = f32(s + f32(f32(f32(f32(f32(2 * a) - f32(5 * b)) + f32(4 * c)) - d) * t2));
    s = f32(s + f32(f32(f32(f32(-a + f32(3 * b)) - f32(3 * c)) + d) * t3));
    return f32(0.5 * s);
  };
  return { x: axis(v1.x, v2.x, v3.x, v4.x), y: axis(v1.y, v2.y, v3.y, v4.y) };
}

export function catmullToPiecewiseLinear(cp: V2[]): V2[] {
  const result: V2[] = [];
  for (let i = 0; i < cp.length - 1; i++) {
    const v1 = i > 0 ? cp[i - 1] : cp[i];
    const v2 = cp[i];
    const v3 = i < cp.length - 1 ? cp[i + 1] : sub(add(v2, v2), v1);
    const v4 = i < cp.length - 2 ? cp[i + 2] : sub(add(v3, v3), v2);
    for (let c = 0; c < CATMULL_DETAIL; c++) {
      result.push(catmullFindPoint(v1, v2, v3, v4, f32(c / CATMULL_DETAIL)));
      result.push(catmullFindPoint(v1, v2, v3, v4, f32((c + 1) / CATMULL_DETAIL)));
    }
  }
  return result;
}

interface Arc {
  thetaStart: number;
  thetaRange: number;
  direction: number;
  radius: number;
  centre: V2;
}

export function circularArcProperties(cp: V2[]): Arc | null {
  const [a, b, c] = cp;
  if (almostEqualsF(0, f32(f32(f32(b.y - a.y) * f32(c.x - a.x)) - f32(f32(b.x - a.x) * f32(c.y - a.y))))) return null;
  const bc = sub(b, c);
  const ca = sub(c, a);
  const ab = sub(a, b);
  const d = f32(2 * f32(f32(f32(a.x * bc.y) + f32(b.x * ca.y)) + f32(c.x * ab.y)));
  const aSq = lengthSq(a);
  const bSq = lengthSq(b);
  const cSq = lengthSq(c);
  const cb = sub(c, b);
  const ac = sub(a, c);
  const ba = sub(b, a);
  const cx = f32(f32(f32(aSq * bc.y) + f32(bSq * ca.y)) + f32(cSq * ab.y));
  const cy = f32(f32(f32(aSq * cb.x) + f32(bSq * ac.x)) + f32(cSq * ba.x));
  const centre = { x: f32(cx / d), y: f32(cy / d) };
  const dA = sub(a, centre);
  const dC = sub(c, centre);
  const radius = length(dA);
  const thetaStart = Math.atan2(dA.y, dA.x);
  let thetaEnd = Math.atan2(dC.y, dC.x);
  while (thetaEnd < thetaStart) thetaEnd += 2 * Math.PI;
  let direction = 1;
  let thetaRange = thetaEnd - thetaStart;
  const ortho = vec(ca.y, -ca.x);
  if (dot(ortho, ba) < 0) {
    direction = -direction;
    thetaRange = 2 * Math.PI - thetaRange;
  }
  return { thetaStart, thetaRange, direction, radius, centre };
}

function arcPointCount(arc: Arc): number {
  if (f32(2 * arc.radius) <= CIRCULAR_ARC_TOLERANCE) return 2;
  return Math.max(2, Math.ceil(arc.thetaRange / (2 * Math.acos(f32(1 - f32(CIRCULAR_ARC_TOLERANCE / arc.radius))))) | 0);
}

export function circularArcToPiecewiseLinear(cp: V2[]): V2[] {
  const arc = circularArcProperties(cp);
  if (!arc) return bSplineToPiecewiseLinear(cp, Math.max(1, cp.length - 1));
  const amount = arcPointCount(arc);
  const output: V2[] = [];
  for (let i = 0; i < amount; i++) {
    const fract = i / (amount - 1);
    const theta = arc.thetaStart + arc.direction * fract * arc.thetaRange;
    output.push(add(arc.centre, scale(vec(Math.cos(theta), Math.sin(theta)), arc.radius)));
  }
  return output;
}

// --- Legacy path string conversion (ConvertHitObjectParser) ---

function isLinear(p0: V2, p1: V2, p2: V2): boolean {
  return almostEqualsF(0, f32(f32(f32(p1.y - p0.y) * f32(p2.x - p0.x)) - f32(f32(p1.x - p0.x) * f32(p2.y - p0.y))));
}

/**
 * Control points for a legacy slider: `points` are relative to the head and exclude it.
 * Splits implicit segments at repeated points (red anchors) like lazer does.
 */
export function legacyControlPoints(type: PathType, points: V2[], formatVersion: number): ControlPoint[] {
  const all = [ZERO, ...points];
  if (type === 'P') {
    if (formatVersion < FIRST_LAZER_VERSION) {
      if (all.length !== 3) type = 'B';
      else if (isLinear(all[0], all[1], all[2])) type = 'L';
    } else if (all.length > 3) type = 'B';
  }
  const vertices: ControlPoint[] = all.map((pos) => ({ pos, type: null }));
  vertices[0].type = type;
  const out: ControlPoint[] = [];
  let startIndex = 0;
  let endIndex = 0;
  while (++endIndex < vertices.length) {
    if (!equals(vertices[endIndex].pos, vertices[endIndex - 1].pos)) continue;
    if (type === 'C' && endIndex > 1 && formatVersion < FIRST_LAZER_VERSION) continue;
    if (endIndex === vertices.length - 1) continue;
    vertices[endIndex - 1].type = type;
    out.push(...vertices.slice(startIndex, endIndex));
    startIndex = endIndex + 1;
  }
  if (startIndex < endIndex) out.push(...vertices.slice(startIndex, endIndex));
  return out;
}

// --- SliderPath ---

export class LazerSliderPath {
  readonly calculatedPath: V2[] = [];
  readonly cumulativeLength: number[] = [];
  private optimisedLength = 0;

  constructor(controlPoints: ControlPoint[], expectedDistance: number | null, optimiseCatmull = true) {
    this.calculatePath(controlPoints, optimiseCatmull);
    this.calculateLength(expectedDistance);
  }

  get distance(): number {
    return this.cumulativeLength.length === 0 ? 0 : this.cumulativeLength[this.cumulativeLength.length - 1];
  }

  private calculatePath(cps: ControlPoint[], optimiseCatmull: boolean) {
    const path = this.calculatedPath;
    if (cps.length === 0) return;
    let start = 0;
    for (let i = 0; i < cps.length; i++) {
      if (cps[i].type === null && i < cps.length - 1) continue;
      const segment = cps.slice(start, i + 1).map((c) => c.pos);
      const segmentType = cps[start].type ?? 'L';
      if (segment.length === 1) path.push(segment[0]);
      else if (segment.length > 1) {
        const subPath = this.calculateSubPath(segment, segmentType, optimiseCatmull);
        const skipFirst = path.length > 0 && subPath.length > 0 && equals(path[path.length - 1], subPath[0]);
        for (let j = skipFirst ? 1 : 0; j < subPath.length; j++) path.push(subPath[j]);
      }
      start = i;
    }
  }

  private calculateSubPath(cp: V2[], type: PathType, optimiseCatmull: boolean): V2[] {
    switch (type) {
      case 'L':
        return cp.slice();
      case 'P': {
        if (cp.length !== 3) break;
        const arc = circularArcProperties(cp);
        if (!arc) break;
        const radius = arc.radius;
        const subPoints =
          f32(2 * radius) <= CIRCULAR_ARC_TOLERANCE
            ? 2
            : Math.max(2, Math.ceil(arc.thetaRange / (2.0 * Math.acos(f32(1 - f32(CIRCULAR_ARC_TOLERANCE / radius))))) | 0);
        if (subPoints >= 1000) break;
        const sub = circularArcToPiecewiseLinear(cp);
        if (sub.length === 0) break;
        return sub;
      }
      case 'C': {
        const sub = catmullToPiecewiseLinear(cp);
        if (!optimiseCatmull) return sub;
        return this.optimiseCatmull(sub);
      }
    }
    return bSplineToPiecewiseLinear(cp, cp.length);
  }

  private optimiseCatmull(subPath: V2[]): V2[] {
    const optimised: V2[] = [];
    let lastStart: V2 | null = null;
    let lengthRemovedSinceStart = 0;
    for (let i = 0; i < subPath.length; i++) {
      if (lastStart === null) {
        optimised.push(subPath[i]);
        lastStart = subPath[i];
        continue;
      }
      const distFromStart = length(sub(subPath[i], lastStart));
      lengthRemovedSinceStart += length(sub(subPath[i], subPath[i - 1]));
      if (distFromStart > 6 || (i + 1) % (CATMULL_DETAIL * 2) === 0 || i === subPath.length - 1) {
        optimised.push(subPath[i]);
        this.optimisedLength += lengthRemovedSinceStart - distFromStart;
        lastStart = null;
        lengthRemovedSinceStart = 0;
      }
    }
    return optimised;
  }

  private calculateLength(expectedDistance: number | null) {
    const path = this.calculatedPath;
    const cumulative = this.cumulativeLength;
    let calculatedLength = this.optimisedLength;
    cumulative.push(0);
    for (let i = 0; i < path.length - 1; i++) {
      calculatedLength += length(sub(path[i + 1], path[i]));
      cumulative.push(calculatedLength);
    }
    if (expectedDistance === null || calculatedLength === expectedDistance) return;
    if (path.length >= 2 && equals(path[path.length - 1], path[path.length - 2]) && expectedDistance > calculatedLength) {
      cumulative.push(calculatedLength);
      return;
    }
    cumulative.pop();
    let pathEndIndex = path.length - 1;
    if (calculatedLength > expectedDistance) {
      while (cumulative.length > 0 && cumulative[cumulative.length - 1] >= expectedDistance) {
        cumulative.pop();
        path.splice(pathEndIndex--, 1);
      }
    }
    if (pathEndIndex <= 0) {
      cumulative.push(0);
      return;
    }
    const dir = normalized(sub(path[pathEndIndex], path[pathEndIndex - 1]));
    path[pathEndIndex] = add(path[pathEndIndex - 1], scale(dir, f32(expectedDistance - cumulative[cumulative.length - 1])));
    cumulative.push(expectedDistance);
  }

  positionAt(progress: number): V2 {
    const d = Math.min(Math.max(progress, 0), 1) * this.distance;
    let i = binarySearch(this.cumulativeLength, d, compareNumbers);
    if (i < 0) i = ~i;
    return this.interpolateVertices(i, d);
  }

  private interpolateVertices(i: number, d: number): V2 {
    const path = this.calculatedPath;
    if (path.length === 0) return ZERO;
    if (i <= 0) return path[0];
    if (i >= path.length) return path[path.length - 1];
    const p0 = path[i - 1];
    const p1 = path[i];
    const d0 = this.cumulativeLength[i - 1];
    const d1 = this.cumulativeLength[i];
    if (almostEquals(d0, d1)) return p0;
    const w = (d - d0) / (d1 - d0);
    return add(p0, scale(sub(p1, p0), f32(w)));
  }
}
