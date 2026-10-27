// Peak data of the song for the timeline waveform, decoded once per audio file.
import { songPeaks } from './songData';

export { WAVEFORM_BUCKET_MS } from './songData';

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
    void songPeaks(blob).then(
      (peaks) => cache.set(blob, { peaks }),
      () => cache.set(blob, 'failed'),
    );
    return null;
  }
  return typeof c === 'string' ? null : c;
}
