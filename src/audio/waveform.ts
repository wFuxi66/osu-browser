// Peak data of the song for the timeline waveform, decoded once per audio file.

/** Milliseconds per peak bucket. */
export const WAVEFORM_BUCKET_MS = 4;

export interface Waveform {
  /** Max absolute amplitude (0..1) per bucket. */
  peaks: Float32Array;
}

const cache = new WeakMap<Blob, Waveform | 'loading' | 'failed'>();

/** The waveform for an audio file, or null while it is being decoded (or if decoding failed). */
export function waveformFor(blob: Blob): Waveform | null {
  const c = cache.get(blob);
  if (c === undefined) {
    cache.set(blob, 'loading');
    void decode(blob).then(
      (w) => cache.set(blob, w),
      () => cache.set(blob, 'failed'),
    );
    return null;
  }
  return typeof c === 'string' ? null : c;
}

async function decode(blob: Blob): Promise<Waveform> {
  // A low sample rate is plenty for peaks and keeps memory small for long songs.
  const ctx = new OfflineAudioContext(1, 1, 8000);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const per = Math.max(1, Math.round((buf.sampleRate * WAVEFORM_BUCKET_MS) / 1000));
  const n = Math.ceil(buf.length / per);
  const peaks = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = peaks[i];
      const end = Math.min(data.length, (i + 1) * per);
      for (let j = i * per; j < end; j++) {
        const v = data[j] < 0 ? -data[j] : data[j];
        if (v > m) m = v;
      }
      peaks[i] = m;
    }
  }
  let max = 0;
  for (const p of peaks) max = Math.max(max, p);
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  return { peaks };
}
