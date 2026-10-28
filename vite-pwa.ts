// Writes the service worker (src/pwa/sw.js) into the build with the list of files it precaches: every file of the
// build with a hash of its contents, so an update only downloads what changed. ffmpeg's files are left to be cached
// when first used (they're most of the build, and only convert old background videos).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { CHANGELOG } from './src/changelog.ts';

const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex').slice(0, 16);

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)]));
}

export function serviceWorker(): Plugin {
  let outDir = '';
  const lazy = new Set<string>();
  return {
    name: 'osu-browser-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    generateBundle(_, bundle) {
      lazy.clear();
      for (const f of Object.values(bundle)) {
        const ids = f.type === 'chunk' ? f.moduleIds : f.originalFileNames;
        if (ids.some((id) => id.replace(/\\/g, '/').includes('/@ffmpeg/core/'))) lazy.add(`/${f.fileName}`);
      }
    },
    writeBundle() {
      const precache: Record<string, string> = {};
      for (const file of filesIn(outDir)) {
        const url = '/' + relative(outDir, file).split(sep).join('/');
        if (url === '/sw.js' || lazy.has(url)) continue;
        precache[url] = hash(readFileSync(file));
      }
      const version = hash(JSON.stringify(precache));
      const src = readFileSync(new URL('./src/pwa/sw.js', import.meta.url), 'utf8');
      const head = `const PRECACHE = ${JSON.stringify(precache)};\nconst LAZY = ${JSON.stringify([...lazy])};\nconst VERSION = '${version}';\nconst CHANGELOG = ${JSON.stringify(CHANGELOG)};\n`;
      writeFileSync(join(outDir, 'sw.js'), head + src.replace('/* global PRECACHE, LAZY, VERSION, CHANGELOG */\n', ''));
    },
  };
}
