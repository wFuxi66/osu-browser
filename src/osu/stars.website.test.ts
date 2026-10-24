// Compares our star ratings with osu.ppy.sh for whole beatmapsets (downloads them, so it's opt-in):
// STARS_SETS="3 39804 1201708" npx vitest run stars.website
import { describe, expect, it } from 'vitest';
import { parseOsu } from './parser';
import { starRating } from './stars';

const sets = (process.env.STARS_SETS ?? '').split(/[\s,]+/).filter(Boolean);
const headers = { 'User-Agent': 'osumappingweb star rating check' };

interface WebBeatmap {
  id: number;
  mode: string;
  version: string;
  difficulty_rating: number;
  convert?: boolean;
}

describe.skipIf(sets.length === 0)('star ratings match osu.ppy.sh', () => {
  for (const set of sets) {
    it(`beatmapset ${set}`, { timeout: 120_000 }, async () => {
      const html = await (await fetch(`https://osu.ppy.sh/beatmapsets/${set}`, { headers })).text();
      const json = /<script id="json-beatmapset" type="application\/json">\s*([\s\S]*?)\s*<\/script>/.exec(html)?.[1];
      expect(json, 'beatmapset page').toBeTruthy();
      const beatmaps: WebBeatmap[] = JSON.parse(json!).beatmaps;
      for (const b of beatmaps) {
        const bm = parseOsu(await (await fetch(`https://osu.ppy.sh/osu/${b.id}`, { headers })).text());
        const ours = starRating(bm);
        if (ours === null) continue;
        expect(ours, `${b.id} [${b.version}] (${b.mode})`).toBeCloseTo(b.difficulty_rating, 3);
      }
    });
  }
});
