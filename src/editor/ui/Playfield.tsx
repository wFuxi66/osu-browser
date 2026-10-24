import { useEffect, useRef } from 'react';
import { findFile } from '../../project/project';
import { onFrame } from '../playback';
import { CatchMode } from '../playfield/catchMode';
import { ManiaMode } from '../playfield/maniaMode';
import { StdMode } from '../playfield/stdMode';
import { TaikoMode } from '../playfield/taikoMode';
import type { PlayfieldMode } from '../playfield/types';
import { editor } from '../store';
import { fitFrame, storyboard, type SbFrame } from '../storyboard/runtime';
import { video } from '../video';

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

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, w: number, h: number) {
  const s = Math.max(w / sw, h / sh);
  ctx.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
}

/** Background image, video and storyboard at song time t, dimmed like stable's editor. */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dim: number,
  t: number,
  opts: { frame?: SbFrame; storyboard?: boolean; background?: boolean } = {},
) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const prefs = editor.prefs;
  const showSb = (opts.storyboard ?? prefs.showStoryboard) && editor.hasProject;
  if (showSb) storyboard.sync();
  const bg = editor.hasProject && opts.background !== false ? editor.bm.events.background : null;
  // Like the game, a storyboard that draws the background file itself replaces the static background.
  const img = bg && !(showSb && storyboard.usesFile(bg.filename)) ? backgroundImage() : null;
  let drew = false;
  if (img) {
    drawCover(ctx, img, img.naturalWidth, img.naturalHeight, w, h);
    drew = true;
  }
  const vid = editor.hasProject ? video.frameAt(t, prefs.showVideo && opts.background !== false) : null;
  if (vid) {
    drawCover(ctx, vid, vid.videoWidth, vid.videoHeight, w, h);
    drew = true;
  }
  if (showSb) drew = storyboard.draw(ctx, opts.frame ?? fitFrame(w, h, false), t, { widescreen: editor.bm.general.widescreenStoryboard }) || drew;
  if (drew) {
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
        mode = m === 3 ? new ManiaMode() : m === 1 ? new TaikoMode() : m === 2 ? new CatchMode() : new StdMode();
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
      drawBackground(ctx, w, h, editor.prefs.backgroundDim, t);
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
