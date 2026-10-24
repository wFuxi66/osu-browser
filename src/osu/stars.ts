// Star rating, using ports of lazer's difficulty calculators (see src/osu/difficulty/). Returns null when a
// mode isn't supported.
import { osuDifficulty } from './difficulty/osu';
import { catchStarRating } from './difficulty/catch';
import { maniaStarRating } from './difficulty/mania';
import { taikoStarRating } from './difficulty/taiko';
import type { Beatmap } from './types';

/** Changes whenever the calculators change, so ratings cached in IndexedDB get recalculated. */
export const STAR_RATING_VERSION = 'lazer-2026.730.0';

const cache = new WeakMap<Beatmap, number | null>();

function calculate(bm: Beatmap): number | null {
  switch (bm.general.mode) {
    case 0:
      return osuDifficulty(bm).starRating;
    case 1:
      return taikoStarRating(bm);
    case 2:
      return catchStarRating(bm);
    case 3:
      return maniaStarRating(bm);
    default:
      return null;
  }
}

export function starRating(bm: Beatmap): number | null {
  if (cache.has(bm)) return cache.get(bm)!;
  let stars: number | null = null;
  try {
    stars = calculate(bm);
  } catch (e) {
    console.warn('Star rating failed', e);
  }
  if (stars !== null && !Number.isFinite(stars)) stars = null;
  cache.set(bm, stars);
  return stars;
}
