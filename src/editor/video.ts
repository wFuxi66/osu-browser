// Beatmap background video, kept in sync with the music clock. Videos the browser can't play are converted first.
import { music } from '../audio/music';
import { findFile } from '../project/project';
import { editor } from './store';
import { convertVideo, needsConversion } from './videoConvert';

/** Allowed drift (s) during playback before the video is re-seeked. */
const MAX_DRIFT = 0.12;

class VideoBackground {
  readonly el: HTMLVideoElement;
  private blob: Blob | null = null;
  private url: string | null = null;
  /** The beatmap's video file, whichever blob is playing for it. */
  private original: Blob | null = null;
  /** Originals the browser couldn't play (or showed no picture for), and their H.264 copies once converted. */
  private unplayable = new WeakSet<Blob>();
  private converted = new WeakMap<Blob, Blob>();
  private converting = new WeakSet<Blob>();
  /** Videos that can't be shown at all: the conversion failed too. */
  private failed = new WeakSet<Blob>();

  constructor() {
    this.el = document.createElement('video');
    this.el.muted = true;
    this.el.playsInline = true;
    this.el.preload = 'auto';
    this.el.addEventListener('error', () => this.reject());
    // A codec the browser lacks can still "load" with audio only: no picture means it needs converting too.
    this.el.addEventListener('loadedmetadata', () => {
      if (!this.el.videoWidth) this.reject();
    });
  }

  private reject() {
    const blob = this.blob;
    if (!blob || !this.original) return;
    // The original gets converted; a converted copy that still won't play means giving up on this video.
    if (blob === this.original) this.unplayable.add(blob);
    else this.failed.add(this.original);
    this.setSource(null);
  }

  /** What to play for this video file: itself, its converted copy, or nothing yet while it's being converted. */
  private playable(blob: Blob, filename: string): Blob | null {
    if (this.failed.has(blob)) return null;
    const copy = this.converted.get(blob);
    if (copy) return copy;
    if (!this.unplayable.has(blob) && !needsConversion(filename)) return blob;
    if (!this.converting.has(blob)) this.convert(blob, filename);
    return null;
  }

  private convert(blob: Blob, filename: string) {
    this.converting.add(blob);
    let toast: ReturnType<typeof editor.stickyToast> | null = null;
    const show = (text: string) => (toast ? toast.update(text) : (toast = editor.stickyToast(text)));
    convertVideo(blob, filename, (stage, ratio) =>
      show(stage === 'loading' ? `Loading the video converter for "${filename}"…` : `Converting the background video "${filename}"… ${Math.round(ratio * 100)}%`),
    )
      .then((out) => {
        this.converted.set(blob, out);
        if (toast) editor.toast(`Converted "${filename}" so it can play here.`);
      })
      .catch((e: Error) => {
        this.failed.add(blob);
        editor.toast(`Couldn't convert the background video "${filename}": ${e.message}`, 'error');
      })
      .finally(() => {
        this.converting.delete(blob);
        (toast as ReturnType<typeof editor.stickyToast> | null)?.close();
        editor.emit();
      });
  }

  private setSource(blob: Blob | null) {
    if (blob === this.blob) return;
    this.blob = blob;
    this.el.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (blob) {
      this.url = URL.createObjectURL(blob);
      this.el.src = this.url;
    } else {
      this.el.removeAttribute('src');
      this.el.load();
    }
  }

  /** Bring the video to song time t; returns the element if a frame should be shown. */
  frameAt(t: number, enabled: boolean): HTMLVideoElement | null {
    const p = editor.project;
    const v = p && editor.hasProject ? editor.bm.events.video : null;
    const file = enabled && p && v ? (findFile(p, v.filename) ?? null) : null;
    this.original = file;
    const blob = file && v ? this.playable(file, v.filename) : null;
    this.setSource(blob);
    if (!blob || !v || !this.url) return null;
    const vt = (t - v.startTime) / 1000;
    const dur = this.el.duration;
    if (vt < 0 || (Number.isFinite(dur) && vt > dur)) {
      if (!this.el.paused) this.el.pause();
      return null;
    }
    if (music.playing) {
      if (this.el.playbackRate !== music.rate) this.el.playbackRate = music.rate;
      if (this.el.paused) void this.el.play().catch(() => undefined);
      if (!this.el.seeking && Math.abs(this.el.currentTime - vt) > MAX_DRIFT) this.el.currentTime = vt;
    } else {
      if (!this.el.paused) this.el.pause();
      if (!this.el.seeking && Math.abs(this.el.currentTime - vt) > 1 / 60) this.el.currentTime = vt;
    }
    return this.el.readyState >= 2 && this.el.videoWidth ? this.el : null;
  }
}

export const video = new VideoBackground();
