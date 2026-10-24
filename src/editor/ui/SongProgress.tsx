import { useEffect, useRef } from 'react';
import { music } from '../../audio/music';
import { onFrame } from '../playback';
import { editor } from '../store';

/** The full-song overview bar: bookmarks, timing points, kiai, breaks, preview point. Click/drag to seek. */
export function SongProgress() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(canvas);

    const off = onFrame((t) => {
      if (!editor.hasProject || !w) return;
      const bm = editor.bm;
      const dur = music.duration || 1;
      const X = (time: number) => (time / dur) * w;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#101014';
      ctx.fillRect(0, 0, w, h);
      const tps = bm.timingPoints;
      for (let i = 0; i < tps.length; i++) {
        if (!tps[i].kiai) continue;
        const next = tps.slice(i + 1).find((p) => !p.kiai);
        ctx.fillStyle = 'rgba(255,140,0,0.35)';
        ctx.fillRect(X(tps[i].time), h * 0.55, X(next ? next.time : dur) - X(tps[i].time), h * 0.2);
      }
      for (const br of bm.events.breaks) {
        ctx.fillStyle = 'rgba(140,140,255,0.35)';
        ctx.fillRect(X(br.start), h * 0.3, X(br.end) - X(br.start), h * 0.2);
      }
      // Object density
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (const o of bm.hitObjects) ctx.fillRect(X(o.time), h * 0.78, 1, h * 0.22);
      for (const tp of tps) {
        ctx.fillStyle = tp.uninherited ? '#ff3c3c' : 'rgba(70,210,70,0.8)';
        ctx.fillRect(X(tp.time), tp.uninherited ? 0 : h * 0.12, tp.uninherited ? 2 : 1, tp.uninherited ? h * 0.3 : h * 0.18);
      }
      for (const b of bm.editor.bookmarks) {
        ctx.fillStyle = '#4aa8ff';
        ctx.fillRect(X(b), h * 0.5, 2, h * 0.5);
      }
      if (bm.general.previewTime >= 0) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(X(bm.general.previewTime), 0, 1, h);
      }
      ctx.fillStyle = '#ffd400';
      ctx.fillRect(X(t) - 1, 0, 3, h);
    });

    let dragging = false;
    const seekTo = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      music.seek(((e.clientX - r.left) / r.width) * (music.duration || 0));
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      seekTo(e);
    };
    const move = (e: PointerEvent) => dragging && seekTo(e);
    const up = () => (dragging = false);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    return () => {
      off();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
    };
  }, []);

  return <canvas ref={ref} className="progress-canvas" />;
}
