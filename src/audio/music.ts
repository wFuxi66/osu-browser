// Music playback with a smooth, high-resolution clock on top of HTMLAudioElement.
// HTMLAudioElement is used (instead of an AudioBufferSourceNode) so that playback rate changes keep pitch,
// matching the stable editor's 25/50/75% playback.

type Listener = () => void;

class MusicClock {
  readonly el: HTMLAudioElement;
  private url: string | null = null;
  private anchorAudio = 0;
  private anchorPerf = 0;
  private lastReported = -1;
  private pausedTime = 0;
  private listeners = new Set<Listener>();
  duration = 0;
  /** User-configurable latency compensation in ms (positive = hitsounds/visuals later). */
  offset = 0;

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

  async load(blob: Blob | null): Promise<void> {
    this.pause();
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
    await new Promise<void>((resolve) => {
      const done = () => {
        this.el.removeEventListener('loadedmetadata', done);
        this.el.removeEventListener('error', done);
        resolve();
      };
      this.el.addEventListener('loadedmetadata', done);
      this.el.addEventListener('error', done);
    });
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
      }
    }
    return Math.min(this.anchorAudio + (now - this.anchorPerf) * this.el.playbackRate, this.duration || Infinity) - this.offset;
  }

  private resync() {
    this.anchorAudio = this.el.currentTime * 1000;
    this.anchorPerf = performance.now();
    this.lastReported = this.anchorAudio;
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

  seek(ms: number) {
    const t = Math.max(0, Math.min(ms, this.duration || ms));
    this.pausedTime = t;
    this.el.currentTime = Math.max(0, t + this.offset) / 1000;
    this.resync();
    this.emit();
  }
}

export const music = new MusicClock();
