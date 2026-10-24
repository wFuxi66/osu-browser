// Round-trip check against real beatmaps: FIDELITY_DIR=/path/to/extracted/osz npx vitest run fidelity
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOsu } from './parser';
import { serializeBeatmap } from './serializer';

const dir = process.env.FIDELITY_DIR;

function section(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('[')) break;
    if (l && !l.startsWith('//')) out.push(l);
  }
  return out;
}

/** Normalise equivalent spellings (omitted trailing fields, float formatting) before comparing. */
function normObject(line: string): string {
  const p = line.split(',');
  const type = Number(p[3]);
  p[0] = String(Math.round(Number(p[0])));
  p[1] = String(Math.round(Number(p[1])));
  if (type & 2) {
    p[7] = String(Number(Number(p[7]).toPrecision(12)));
    while (p.length < 11) p.push(p.length === 8 ? p[4] : p.length === 9 ? '' : '0:0:0:0:');
    if (p[10] === '0:0:0:0:' || p[10] === '0:0:0:0') p[10] = 'default';
    // Omitted edge sounds/sets default to the object's hitsound / auto sets.
    const slides = Number(p[6]);
    const es = p[8] ? p[8].split('|') : [];
    const ss = p[9] ? p[9].split('|') : [];
    p[8] = Array.from({ length: slides + 1 }, (_, i) => es[i] ?? p[4]).join('|');
    p[9] = Array.from({ length: slides + 1 }, (_, i) => ss[i] ?? '0:0').join('|');
  } else {
    const last = p.length - 1;
    if (p[last] === '0:0:0:0:' || p[last] === '0:0:0:0' || p.length === 5 || (type & 8 && p.length === 6)) {
      if (p.length > 5 && !(type & 8 && p.length === 6)) p[last] = 'default';
      else p.push('default');
    }
  }
  return p.join(',');
}

function normTiming(line: string): string {
  const p = line.split(',');
  return [Math.round(Number(p[0])), Number(Number(p[1]).toPrecision(12)), p[2] ?? 4, p[3] ?? 0, p[4] ?? 0, p[5] ?? 100, p[6] ?? (Number(p[1]) > 0 ? 1 : 0), p[7] ?? 0].join(',');
}

describe.skipIf(!dir)('real beatmap fidelity', () => {
  const files = dir ? readdirSync(dir).filter((f) => f.endsWith('.osu')) : [];
  for (const f of files) {
    it(f, () => {
      const original = readFileSync(join(dir!, f), 'utf8');
      const out = serializeBeatmap(parseOsu(original));
      const origObjs = section(original, 'HitObjects').map(normObject);
      const outObjs = section(out, 'HitObjects').map(normObject);
      const diffs = origObjs.map((l, i) => [l, outObjs[i]]).filter(([a, b]) => a !== b);
      if (diffs.length) console.log(f, 'object diffs:', diffs.length, diffs.slice(0, 5));
      const origTp = section(original, 'TimingPoints').map(normTiming);
      const outTp = section(out, 'TimingPoints').map(normTiming);
      const tpDiffs = origTp.map((l, i) => [l, outTp[i]]).filter(([a, b]) => a !== b);
      if (tpDiffs.length) console.log(f, 'timing diffs:', tpDiffs.length, tpDiffs.slice(0, 5));
      expect(outObjs.length).toBe(origObjs.length);
      expect(outTp.length).toBe(origTp.length);
      expect(section(out, 'Events').filter((l) => !l.startsWith('2,')).length).toBeGreaterThanOrEqual(
        section(original, 'Events').filter((l) => !/^(2|Break),/.test(l)).length,
      );
      expect(diffs.length).toBe(0);
      expect(tpDiffs.length).toBe(0);
    });
  }
});
