import { useEffect, useRef } from 'react';
import { music } from '../../audio/music';
import { onFrame, redrawNext } from '../playback';
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
      redrawNext();
    });
    ro.observe(canvas);

    // The marks only change with the map, and a map can have a thousand timing points: they're drawn once into this
    // layer, and each frame copies it under the playhead.
    const marks = document.createElement('canvas');
    let marksKey = '';
    const drawMarks = (dur: number) => {
      const bm = editor.bm;
      const m = marks.getContext('2d')!;
      marks.width = canvas.width;
      marks.height = canvas.height;
      m.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      const X = (time: number) => (time / dur) * w;
      // Stable's colours: grey breaks, orange kiai, red/green timing points, blue bookmarks, yellow preview point.
      const mid = h * 0.5;
      m.fillStyle = 'rgba(255,255,255,0.35)';
      m.fillRect(0, mid - 0.5, w, 1);
      const tps = bm.timingPoints;
      m.fillStyle = 'rgba(255,150,30,0.55)';
      for (let i = 0; i < tps.length; i++) {
        if (!tps[i].kiai) continue;
        let j = i + 1;
        while (j < tps.length && tps[j].kiai) j++;
        m.fillRect(X(tps[i].time), mid - h * 0.12, X(j < tps.length ? tps[j].time : dur) - X(tps[i].time), h * 0.24);
        i = j;
      }
      m.fillStyle = 'rgba(200,200,200,0.45)';
      for (const br of bm.events.breaks) m.fillRect(X(br.start), mid - h * 0.12, X(br.end) - X(br.start), h * 0.24);
      for (const tp of tps) {
        m.fillStyle = tp.uninherited ? 'rgba(255,60,60,0.9)' : 'rgba(110,190,60,0.75)';
        m.fillRect(X(tp.time), tp.uninherited ? h * 0.1 : h * 0.25, 1, tp.uninherited ? h * 0.8 : h * 0.5);
      }
      m.fillStyle = '#3d9bff';
      for (const b of bm.editor.bookmarks) m.fillRect(X(b) - 0.5, h * 0.15, 2, h * 0.7);
      if (bm.general.previewTime >= 0) {
        m.fillStyle = '#ffd400';
        m.fillRect(X(bm.general.previewTime) - 0.5, h * 0.1, 2, h * 0.8);
      }
    };

    const off = onFrame((t) => {
      if (!editor.hasProject || !w) return;
      const dur = music.duration || 1;
      // contentRev changes with every edit to the map (and with another map or difficulty).
      const key = `${editor.contentRev}|${dur}|${canvas.width}|${canvas.height}`;
      if (key !== marksKey) {
        marksKey = key;
        drawMarks(dur);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(marks, 0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.fillRect((t / dur) * w - 1.5, 0, 3, h);
    });

    // Input goes to the .ed-progress wrapper, whose hit area reaches a little above the bar on touch screens.
    const area = canvas.parentElement!;
    let dragging = false;
    const seekTo = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      music.seek(((e.clientX - r.left) / r.width) * (music.duration || 0));
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      area.setPointerCapture(e.pointerId);
      seekTo(e);
    };
    const move = (e: PointerEvent) => dragging && seekTo(e);
    const up = () => (dragging = false);
    area.addEventListener('pointerdown', down);
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', up);
    return () => {
      off();
      ro.disconnect();
      area.removeEventListener('pointerdown', down);
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerup', up);
      area.removeEventListener('pointercancel', up);
    };
  }, []);

  return <canvas ref={ref} className="progress-canvas" />;
}
