import { useEffect, useRef } from 'react';
import { music } from '../../audio/music';
import { onFrame } from '../playback';
import { editor } from '../store';
import { canvasDpr } from '../../ui/touch';

/** The full-song overview bar: bookmarks, timing points, kiai, breaks, preview point. Click/drag to seek. */
export function SongProgress() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    const ro = new ResizeObserver(() => {
      const dpr = canvasDpr();
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
      // Stable's colours: grey breaks, orange kiai, red/green timing points, blue bookmarks, yellow preview point.
      const mid = h * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, mid - 0.5, w, 1);
      const tps = bm.timingPoints;
      for (let i = 0; i < tps.length; i++) {
        if (!tps[i].kiai || (i > 0 && tps[i - 1].kiai)) continue;
        const next = tps.slice(i + 1).find((p) => !p.kiai);
        ctx.fillStyle = 'rgba(255,150,30,0.55)';
        ctx.fillRect(X(tps[i].time), mid - h * 0.12, X(next ? next.time : dur) - X(tps[i].time), h * 0.24);
      }
      for (const br of bm.events.breaks) {
        ctx.fillStyle = 'rgba(200,200,200,0.45)';
        ctx.fillRect(X(br.start), mid - h * 0.12, X(br.end) - X(br.start), h * 0.24);
      }
      for (const tp of tps) {
        ctx.fillStyle = tp.uninherited ? 'rgba(255,60,60,0.9)' : 'rgba(110,190,60,0.75)';
        ctx.fillRect(X(tp.time), tp.uninherited ? h * 0.1 : h * 0.25, 1, tp.uninherited ? h * 0.8 : h * 0.5);
      }
      for (const b of bm.editor.bookmarks) {
        ctx.fillStyle = '#3d9bff';
        ctx.fillRect(X(b) - 0.5, h * 0.15, 2, h * 0.7);
      }
      if (bm.general.previewTime >= 0) {
        ctx.fillStyle = '#ffd400';
        ctx.fillRect(X(bm.general.previewTime) - 0.5, h * 0.1, 2, h * 0.8);
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(X(t) - 1.5, 0, 3, h);
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
