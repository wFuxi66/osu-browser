// Beatmap background video, kept in sync with the music clock.
import { music } from '../audio/music';
import { findFile } from '../project/project';
import { editor } from './store';

/** Allowed drift (s) during playback before the video is re-seeked. */
const MAX_DRIFT = 0.12;

class VideoBackground {
  readonly el: HTMLVideoElement;
  private blob: Blob | null = null;
  private url: string | null = null;
  private failed = new WeakSet<Blob>();
  private warned = new WeakSet<Blob>();

  constructor() {
    this.el = document.createElement('video');
    this.el.muted = true;
    this.el.playsInline = true;
    this.el.preload = 'auto';
    this.el.addEventListener('error', () => {
      if (!this.blob) return;
      this.failed.add(this.blob);
      if (!this.warned.has(this.blob)) {
        this.warned.add(this.blob);
        editor.toast(`This browser can't play the background video "${editor.bm.events.video?.filename}". Convert it to H.264 .mp4 or .webm to see it in the editor.`, 'error');
      }
    });
  }

  private setSource(blob: Blob | null) {
    if (blob === this.blob) return;
    this.blob = blob;
    this.el.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (blob && !this.failed.has(blob)) {
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
    const blob = enabled && p && v ? (findFile(p, v.filename) ?? null) : null;
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
