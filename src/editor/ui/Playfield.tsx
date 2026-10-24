import { useEffect, useRef } from 'react';
import { findFile } from '../../project/project';
import { onFrame } from '../playback';
import { ManiaMode } from '../playfield/maniaMode';
import { StdMode } from '../playfield/stdMode';
import { TaikoMode } from '../playfield/taikoMode';
import type { PlayfieldMode } from '../playfield/types';
import { editor } from '../store';

/** The active compose surface, exposed so keyboard shortcuts can reach it (Escape/Enter). */
export const activePlayfield: { current: PlayfieldMode | null } = { current: null };

const bgCache = new Map<Blob, HTMLImageElement>();
function backgroundImage(): HTMLImageElement | null {
  const p = editor.project;
  const bg = p && editor.bm.events.background;
  if (!p || !bg) return null;
  const blob = findFile(p, bg.filename);
  if (!blob) return null;
  let img = bgCache.get(blob);
  if (!img) {
    img = new Image();
    img.src = URL.createObjectURL(blob);
    bgCache.set(blob, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, dim: number) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const img = backgroundImage();
  if (img) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * s;
    const ih = img.naturalHeight * s;
    ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, w, h);
  }
}

export function Playfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    let mode: PlayfieldMode | null = null;
    let modeKey = -1;

    const ensureMode = () => {
      const m = editor.bm.general.mode;
      if (m !== modeKey) {
        modeKey = m;
        mode = m === 3 ? new ManiaMode() : m === 1 ? new TaikoMode() : new StdMode();
        mode.layout(w, h);
        activePlayfield.current = mode;
      }
      return mode!;
    };

    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mode?.layout(w, h);
    });
    ro.observe(canvas);

    const off = onFrame((t) => {
      if (!editor.hasProject || !w) return;
      const m = ensureMode();
      m.layout(w, h);
      drawBackground(ctx, w, h, editor.prefs.backgroundDim);
      m.draw(ctx, t);
    });

    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const syncMods = (e: MouseEvent | KeyboardEvent) => {
      if (!mode) return;
      mode.mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
    };
    const down = (e: PointerEvent) => {
      if (!editor.hasProject) return;
      syncMods(e);
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      ensureMode().pointerDown(p.x, p.y, e.button);
    };
    const move = (e: PointerEvent) => {
      if (!editor.hasProject) return;
      syncMods(e);
      const p = local(e);
      ensureMode().pointerMove(p.x, p.y);
    };
    const up = () => mode?.pointerUp();
    const leave = () => mode?.pointerLeave();
    const dbl = (e: MouseEvent) => {
      const p = local(e);
      mode?.doubleClick(p.x, p.y);
    };
    const keys = (e: KeyboardEvent) => syncMods(e);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    return () => {
      off();
      ro.disconnect();
      activePlayfield.current = null;
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('dblclick', dbl);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('keyup', keys);
    };
  }, []);

  return <canvas ref={canvasRef} className="playfield-canvas" data-wheel="playfield" />;
}
