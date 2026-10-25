// Re-encodes background videos the browser can't play (old .avi/.flv sets, odd codecs) to H.264 .mp4 with ffmpeg.wasm.
// ffmpeg is only downloaded the first time a video needs it. Converted copies are kept in their own IndexedDB store,
// keyed by the original's hash, so the set itself (and what it exports or syncs) keeps the original file.
import type { FFmpeg } from '@ffmpeg/ffmpeg';

const DB_NAME = 'osu-web-editor-videos';
const STORE = 'converted';

/**
 * The osu! website's video command, adjusted for a single-threaded encoder in the browser: a fast preset instead of
 * veryslow, never upscaled past the source (capped at 720p, even sizes for 4:2:0), 4:2:0 so every browser decodes it,
 * frequent keyframes for the editor's seeking, and the moov atom up front.
 */
const ARGS = (input: string, output: string) => [
  '-i', input,
  '-map', '0:v:0',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
  '-vf', "scale=-2:'trunc(min(720,ih)/2)*2'",
  '-pix_fmt', 'yuv420p', '-g', '60',
  '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
  '-movflags', '+faststart',
  output,
];

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

async function cached(key: string): Promise<Blob | undefined> {
  try {
    const d = await open();
    return await new Promise((resolve, reject) => {
      const req = d.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function store(key: string, blob: Blob) {
  try {
    const d = await open();
    d.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key);
  } catch {
    /* storage unavailable or full: it'll be converted again next time */
  }
}

async function hash(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let ffmpeg: Promise<FFmpeg> | null = null;
function loadFfmpeg(): Promise<FFmpeg> {
  ffmpeg ??= (async () => {
    const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/core?url'),
      import('@ffmpeg/core/wasm?url'),
    ]);
    const f = new FFmpeg();
    await f.load({ coreURL, wasmURL });
    return f;
  })();
  ffmpeg.catch(() => (ffmpeg = null));
  return ffmpeg;
}

// One conversion at a time: ffmpeg.wasm runs a single command.
let queue: Promise<unknown> = Promise.resolve();

/** Whether the file is in a container no browser plays, so it's converted without trying it first. */
export function needsConversion(filename: string): boolean {
  return /\.(avi|flv|wmv|mkv|mpe?g|mov|3gp)$/i.test(filename);
}

/** The video as H.264 .mp4, from the cache or converted now; onProgress gets 0–1 while loading ffmpeg or encoding. */
export function convertVideo(blob: Blob, filename: string, onProgress: (stage: 'loading' | 'converting', ratio: number) => void): Promise<Blob> {
  const job = queue.then(async () => {
    const key = await hash(blob);
    const hit = await cached(key);
    if (hit) return hit;
    onProgress('loading', 0);
    const f = await loadFfmpeg();
    const ext = filename.match(/\.[^.]+$/)?.[0] ?? '';
    const input = `in${ext}`;
    const onEvent = ({ progress }: { progress: number }) => onProgress('converting', Math.min(1, Math.max(0, progress)));
    f.on('progress', onEvent);
    try {
      await f.writeFile(input, new Uint8Array(await blob.arrayBuffer()));
      const code = await f.exec(ARGS(input, 'out.mp4'));
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
      const data = await f.readFile('out.mp4');
      const out = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
      await store(key, out);
      return out;
    } finally {
      f.off('progress', onEvent);
      await f.deleteFile(input).catch(() => undefined);
      await f.deleteFile('out.mp4').catch(() => undefined);
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
