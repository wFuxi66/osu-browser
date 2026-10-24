// Music playback with a smooth, high-resolution clock on top of HTMLAudioElement.
// HTMLAudioElement is used (instead of an AudioBufferSourceNode) so that playback rate changes keep pitch,
// matching the stable editor's 25/50/75% playback.

type Listener = () => void;

/** How long a smooth seek takes to ease into place (out-quint, like lazer's editor). */
const GLIDE_MS = 200;
/** How long the clock may run ahead of every position the audio element reports before it steps back. */
const AHEAD_WINDOW_MS = 300;
const MAX_STEP_BACK_MS = 8;

// Browsers seek compressed audio only approximately: in VBR mp3s a seek can land a few hundred ms away from
// the requested time (measured in Edge), which leaves the objects out of sync with the music until the next
// seek. A WAV copy of the decoded song seeks to the exact sample, and playing it back matches the mp3 played
// from the start to within a few ms. The editor uses one; the original file is what gets saved and exported.
const exactCopies = new WeakMap<Blob, Promise<Blob>>();

function exactCopy(blob: Blob): Promise<Blob> {
  let p = exactCopies.get(blob);
  if (!p) {
    p = blob.arrayBuffer().then(async (data) => {
      const buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(data);
      const n = buf.length;
      const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
      const header = new DataView(new ArrayBuffer(44));
      const pcm = new Int16Array(n * channels.length);
      for (let i = 0, o = 0; i < n; i++)
        for (const ch of channels) pcm[o++] = Math.max(-1, Math.min(1, ch[i])) * 32767;
      const text = (at: number, s: string) => [...s].forEach((c, k) => header.setUint8(at + k, c.charCodeAt(0)));
      text(0, 'RIFF');
      header.setUint32(4, 36 + pcm.byteLength, true);
      text(8, 'WAVEfmt ');
      header.setUint32(16, 16, true);
      header.setUint16(20, 1, true);
      header.setUint16(22, channels.length, true);
      header.setUint32(24, buf.sampleRate, true);
      header.setUint32(28, buf.sampleRate * channels.length * 2, true);
      header.setUint16(32, channels.length * 2, true);
      header.setUint16(34, 16, true);
      text(36, 'data');
      header.setUint32(40, pcm.byteLength, true);
      return new Blob([header, pcm], { type: 'audio/wav' });
    });
    exactCopies.set(blob, p);
  }
  return p;
}

class MusicClock {
  readonly el: HTMLAudioElement;
  private url: string | null = null;
  private anchorAudio = 0;
  private anchorPerf = 0;
  private lastReported = -1;
  /** How far the clock has been ahead of the element's reports, at least, since `since`. */
  private ahead = { min: Infinity, since: 0 };
  private pausedTime = 0;
  private glide: { from: number; start: number } | null = null;
  private listeners = new Set<Listener>();
  duration = 0;
  /** The currently loaded audio file. */
  blob: Blob | null = null;
  /** User-configurable latency compensation in ms (positive = hitsounds/visuals later). */
  offset = 0;
  private baseVolume = 1;
  private fadeLevel = 1;
  private fadeFrame = 0;

  constructor() {
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.preservesPitch = true;
    this.el.addEventListener('loadedmetadata', () => {
      this.duration = (this.el.duration || 0) * 1000;
      this.emit();
    });
    this.el.addEventListener('ended', () => {
      this.pausedTime = this.duration;
      this.emit();
    });
    this.el.addEventListener('pause', () => this.emit());
    this.el.addEventListener('play', () => this.emit());
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Loads an audio file. With `exact` (the editor), playback switches to an exact-seeking copy once it's decoded. */
  async load(blob: Blob | null, exact = false): Promise<void> {
    this.blob = blob;
    this.pause();
    cancelAnimationFrame(this.fadeFrame);
    this.fadeLevel = 1;
    this.el.volume = this.baseVolume;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.duration = 0;
    this.pausedTime = 0;
    if (!blob) {
      this.el.removeAttribute('src');
      this.el.load();
      return;
    }
    this.url = URL.createObjectURL(blob);
    this.el.src = this.url;
    await this.metadata();
    if (exact && !blob.type.includes('wav')) void this.switchToExactCopy(blob);
  }

  private metadata(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        this.el.removeEventListener('loadedmetadata', done);
        this.el.removeEventListener('error', done);
        resolve();
      };
      this.el.addEventListener('loadedmetadata', done);
      this.el.addEventListener('error', done);
    });
  }

  private async switchToExactCopy(blob: Blob) {
    let wav: Blob;
    try {
      wav = await exactCopy(blob);
    } catch {
      return; // undecodable here: keep playing the original
    }
    if (this.blob !== blob) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(wav);
    this.el.src = this.url;
    await this.metadata();
    if (this.blob !== blob) return;
    this.el.currentTime = Math.max(0, this.pausedTime + this.offset) / 1000;
    if (wasPlaying) await this.play();
  }

  /** The volume from the settings (0–1); a fade scales it. */
  get volume(): number {
    return this.baseVolume;
  }

  set volume(v: number) {
    this.baseVolume = v;
    this.el.volume = v * this.fadeLevel;
  }

  /** Brings the volume up from silence over `ms`, so a song starting part-way through doesn't cut in. */
  fadeIn(ms: number) {
    this.fade(0, 1, ms);
  }

  /** Takes the volume down to silence over `ms`; loading another song restores it. */
  fadeOut(ms: number) {
    this.fade(Math.sqrt(this.fadeLevel), 0, ms);
  }

  private fade(from: number, to: number, ms: number) {
    cancelAnimationFrame(this.fadeFrame);
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const k = from + (to - from) * t;
      // Squared, as loudness follows amplitude roughly logarithmically: a linear ramp sounds like it jumps.
      this.fadeLevel = k * k;
      this.el.volume = this.baseVolume * this.fadeLevel;
      if (t < 1) this.fadeFrame = requestAnimationFrame(step);
    };
    step();
  }

  get playing(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  get rate(): number {
    return this.el.playbackRate;
  }

  set rate(r: number) {
    this.el.playbackRate = r;
    this.el.defaultPlaybackRate = r;
    this.resync();
    this.emit();
  }

  /** Current song time in ms. */
  get time(): number {
    if (!this.playing) return this.pausedTime;
    const now = performance.now();
    const reported = this.el.currentTime * 1000;
    if (reported !== this.lastReported) {
      this.lastReported = reported;
      const predicted = this.anchorAudio + (now - this.anchorPerf) * this.el.playbackRate;
      // Re-anchor on each new report, but don't let the clock jump backwards by small jitter.
      if (Math.abs(predicted - reported) > 40 || reported > predicted) {
        this.anchorAudio = reported;
        this.anchorPerf = now;
        this.ahead = { min: Infinity, since: now };
      } else {
        // Reports are stale by a varying amount, so the clock reads ahead of most of them. If it stays ahead
        // of even the freshest one for a while (the audio took a moment to resume after a seek), step back,
        // in small steps so the time between two frames never goes backwards enough to look like a seek.
        this.ahead.min = Math.min(this.ahead.min, predicted - reported);
        if (now - this.ahead.since > AHEAD_WINDOW_MS) {
          if (this.ahead.min > 2) this.anchorAudio -= Math.min(this.ahead.min, MAX_STEP_BACK_MS);
          this.ahead = { min: Infinity, since: now };
        }
      }
    }
    return Math.min(this.anchorAudio + (now - this.anchorPerf) * this.el.playbackRate, this.duration || Infinity) - this.offset;
  }

  /** Song time to draw: `time`, except that it eases there after a smooth seek. */
  get displayTime(): number {
    const t = this.time;
    if (!this.glide) return t;
    const k = (performance.now() - this.glide.start) / GLIDE_MS;
    if (k >= 1 || this.playing) {
      this.glide = null;
      return t;
    }
    return t + (this.glide.from - t) * (1 - k) ** 5;
  }

  private resync() {
    this.anchorAudio = this.el.currentTime * 1000;
    this.anchorPerf = performance.now();
    this.lastReported = this.anchorAudio;
    this.ahead = { min: Infinity, since: this.anchorPerf };
  }

  async play() {
    if (!this.url) return;
    if (this.pausedTime >= this.duration - 5) this.seek(0);
    this.el.currentTime = Math.max(0, this.pausedTime + this.offset) / 1000;
    try {
      await this.el.play();
    } catch {
      return;
    }
    this.resync();
    this.emit();
  }

  pause() {
    if (this.playing) this.pausedTime = this.time;
    this.el.pause();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  stop() {
    this.pause();
    this.seek(0);
  }

  /** Jumps to `ms`; with `smooth` while paused, only the drawn time eases there (see displayTime). */
  seek(ms: number, smooth = false) {
    this.glide = smooth && !this.playing ? { from: this.displayTime, start: performance.now() } : null;
    const t = Math.max(0, Math.min(ms, this.duration || ms));
    this.pausedTime = t;
    this.el.currentTime = Math.max(0, t + this.offset) / 1000;
    this.resync();
    this.emit();
  }
}

export const music = new MusicClock();
