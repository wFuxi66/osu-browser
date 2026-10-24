// Single-precision 2D vectors, matching osuTK's Vector2 (lazer does its position maths in floats).
// Each operation rounds to float32 the way C# does, so stacking and distance thresholds land on the same side.

export const f32 = Math.fround;

export interface V2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): V2 => ({ x: f32(x), y: f32(y) });
export const ZERO: V2 = { x: 0, y: 0 };
export const add = (a: V2, b: V2): V2 => ({ x: f32(a.x + b.x), y: f32(a.y + b.y) });
export const sub = (a: V2, b: V2): V2 => ({ x: f32(a.x - b.x), y: f32(a.y - b.y) });
/** `s` must already be a float32 value. */
export const scale = (a: V2, s: number): V2 => ({ x: f32(a.x * s), y: f32(a.y * s) });
export const div = (a: V2, s: number): V2 => ({ x: f32(a.x / s), y: f32(a.y / s) });
export const lengthSq = (a: V2): number => f32(f32(a.x * a.x) + f32(a.y * a.y));
export const length = (a: V2): number => f32(Math.sqrt(lengthSq(a)));
export const distance = (a: V2, b: V2): number => length(sub(b, a));
export const dot = (a: V2, b: V2): number => f32(f32(a.x * b.x) + f32(a.y * b.y));
export const equals = (a: V2, b: V2): boolean => a.x === b.x && a.y === b.y;

export function normalized(a: V2): V2 {
  return scale(a, f32(1 / length(a)));
}

/** .NET's List<T>.BinarySearch: an index of a match, or the bitwise complement of the insertion point. */
export function binarySearch<T>(list: readonly T[], value: T, compare: (a: T, b: T) => number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const i = lo + ((hi - lo) >> 1);
    const c = compare(list[i], value);
    if (c === 0) return i;
    if (c < 0) lo = i + 1;
    else hi = i - 1;
  }
  return ~lo;
}

export const compareNumbers = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
