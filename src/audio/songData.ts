// The song's samples for the editor. One decode gives both the exact-seeking WAV copy (music.ts) and the
// timeline waveform (waveform.ts): decoding a long song takes a second or two, so doing it twice showed. The
// work over every sample runs in a worker, as on the main thread it froze the page for most of a second.
import type { SongJob, SongResult } from './songWorker';
// Inlined into the main bundle: a worker file fetched on first use isn't there offline, and without it the editor
// and the game fell back to the compressed song's approximate seeking (badly off on phones).
import SongWorker from './songWorker?worker&inline';

/** Milliseconds per peak bucket. */
export const WAVEFORM_BUCKET_MS = 4;

const exact = new WeakMap<Blob, Promise<SongResult>>();

/** The WAV copy and the peaks, decoded at the WAV's rate. */
export function exactSong(blob: Blob): Promise<SongResult> {
  let p = exact.get(blob);
  if (!p) {
    p = analyse(blob, 44100, true);
    exact.set(blob, p);
  }
  return p;
}

/** Just the peaks: from exactSong's decode when there is one for this file, else a cheaper one of their own. */
export function songPeaks(blob: Blob): Promise<Float32Array> {
  // A low sample rate is plenty for peaks and keeps memory small for long songs.
  return (exact.get(blob) ?? analyse(blob, 8000, false)).then((r) => r.peaks);
}

async function analyse(blob: Blob, sampleRate: number, wav: boolean): Promise<SongResult> {
  const buf = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const worker = new SongWorker();
  try {
    return await new Promise<SongResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<SongResult>) => resolve(e.data);
      worker.onerror = (e) => reject(new Error(e.message));
      const job: SongJob = { channels, sampleRate: buf.sampleRate, wav, bucketMs: WAVEFORM_BUCKET_MS };
      // Moved rather than copied: the decoded buffer isn't used here afterwards.
      worker.postMessage(job, channels.map((c) => c.buffer));
    });
  } finally {
    worker.terminate();
  }
}
