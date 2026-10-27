// Worker for songData.ts: the work over every sample of a decoded song, kept off the main thread.

export interface SongJob {
  channels: Float32Array[];
  sampleRate: number;
  /** Also build the 16-bit WAV copy. */
  wav: boolean;
  bucketMs: number;
}

export interface SongResult {
  wav: Blob | null;
  /** Max absolute amplitude (0..1, normalised) per bucket. */
  peaks: Float32Array;
}

onmessage = (e: MessageEvent<SongJob>) => {
  const { channels, sampleRate, bucketMs } = e.data;
  const peaks = peaksOf(channels, sampleRate, bucketMs);
  const wav = e.data.wav ? wavOf(channels, sampleRate) : null;
  postMessage({ wav, peaks } satisfies SongResult, { transfer: [peaks.buffer] });
};

function peaksOf(channels: Float32Array[], sampleRate: number, bucketMs: number): Float32Array {
  const per = Math.max(1, Math.round((sampleRate * bucketMs) / 1000));
  const length = channels[0]?.length ?? 0;
  const n = Math.ceil(length / per);
  const peaks = new Float32Array(n);
  for (const data of channels) {
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
  return peaks;
}

function wavOf(channels: Float32Array[], sampleRate: number): Blob {
  const n = channels[0]?.length ?? 0;
  const nc = channels.length;
  const pcm = new Int16Array(n * nc);
  // One channel at a time with plain indexing: this runs over every sample of the song.
  for (let c = 0; c < nc; c++) {
    const ch = channels[c];
    for (let i = 0, o = c; i < n; i++, o += nc) {
      const s = ch[i];
      pcm[o] = (s > 1 ? 1 : s < -1 ? -1 : s) * 32767;
    }
  }
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, k) => header.setUint8(at + k, c.charCodeAt(0)));
  text(0, 'RIFF');
  header.setUint32(4, 36 + pcm.byteLength, true);
  text(8, 'WAVEfmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, nc, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * nc * 2, true);
  header.setUint16(32, nc * 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}
