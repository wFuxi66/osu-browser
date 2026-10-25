import { useEffect, useRef } from 'react';
import { onFrame } from '../playback';
import { editor } from '../store';
import { drawBackground } from './Playfield';
import { canvasDpr } from '../../ui/touch';

/** The dimmed beatmap background (with video/storyboard) behind screens that have no playfield. */
export function StageBackground() {
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
      if (editor.hasProject && w) drawBackground(ctx, w, h, editor.prefs.backgroundDim, t);
    });
    return () => {
      off();
      ro.disconnect();
    };
  }, []);
  return <canvas ref={ref} className="ed-stage-bg" />;
}
