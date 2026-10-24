// Star rating, using ports of lazer's difficulty calculators (see src/osu/difficulty/). Returns null when a
// mode isn't supported.
import { osuDifficulty } from './difficulty/osu';
import type { Beatmap } from './types';

const cache = new WeakMap<Beatmap, number | null>();

export function starRating(bm: Beatmap): number | null {
  if (cache.has(bm)) return cache.get(bm)!;
  let stars: number | null = null;
  try {
    if (bm.general.mode === 0) stars = osuDifficulty(bm).starRating;
  } catch (e) {
    console.warn('Star rating failed', e);
  }
  if (stars !== null && !Number.isFinite(stars)) stars = null;
  cache.set(bm, stars);
  return stars;
}
