import { useEffect, useRef } from 'react';
import { findFile } from '../../project/project';
import { onFrame, redrawNext } from '../playback';
import { CatchMode } from '../playfield/catchMode';
import { ManiaMode } from '../playfield/maniaMode';
import { StdMode } from '../playfield/stdMode';
import { TaikoMode } from '../playfield/taikoMode';
import type { PlayfieldMode } from '../playfield/types';
import { editor } from '../store';
import { fitFrame, storyboard, type SbFrame } from '../storyboard/runtime';
import { video } from '../video';
import { attachTouch, canvasDpr, touchMods, touchedRecently, undoTap } from '../../ui/touch';

/** How far above the finger (CSS px) the placement cursor sits on touch. */
const CURSOR_LIFT = 50;

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
  opts: { frame?: SbFrame; storyboard?: boolean; background?: boolean; video?: boolean } = {},
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
  const vid = editor.hasProject ? video.frameAt(t, (opts.video ?? prefs.showVideo) && opts.background !== false) : null;
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
    let bars = { top: 0, bottom: 0, left: 0, right: 0 };
    let mode: PlayfieldMode | null = null;
    let modeKey = -1;

    const ensureMode = () => {
      const m = editor.bm.general.mode;
      if (m !== modeKey) {
        modeKey = m;
        mode = m === 3 ? new ManiaMode() : m === 1 ? new TaikoMode() : m === 2 ? new CatchMode() : new StdMode();
        mode.layout(w, h, bars);
        activePlayfield.current = mode;
      }
      return mode!;
    };

    const ro = new ResizeObserver(() => {
      const dpr = canvasDpr();
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The bars scale with the stage, so they only change size when the canvas does.
      const r = canvas.getBoundingClientRect();
      const top = canvas.parentElement?.querySelector('.ed-top')?.getBoundingClientRect();
      const bottom = canvas.parentElement?.querySelector('.ed-bottom')?.getBoundingClientRect();
      // Phone layout: the side columns are wide, and the stylesheet says how much of each side they take.
      const side = (name: string) => parseFloat(getComputedStyle(canvas).getPropertyValue(name)) || 0;
      bars = { top: top ? top.bottom - r.top : 0, bottom: bottom ? r.bottom - bottom.top : 0, left: side('--side-l'), right: side('--side-r') };
      redrawNext();
      mode?.layout(w, h, bars);
    });
    ro.observe(canvas);

    const off = onFrame((t) => {
      if (!editor.hasProject || !w) return;
      const m = ensureMode();
      m.layout(w, h, bars);
      drawBackground(ctx, w, h, editor.prefs.backgroundDim, t);
      m.draw(ctx, t);
    });

    const local = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    type ModKeys = { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean };
    let keyMods: ModKeys = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
    const syncMods = (e: ModKeys) => {
      if (!mode) return;
      const t = touchMods.get();
      mode.mods = { shift: e.shiftKey || t.shift, alt: e.altKey || t.alt, ctrl: e.ctrlKey || e.metaKey || t.ctrl };
    };
    const down = (e: PointerEvent) => {
      if (!editor.hasProject || e.pointerType === 'touch') return;
      syncMods(e);
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      if (e.button === 0 && editor.leavePlacement(ensureMode().inPlayfield?.(p.x, p.y) === false)) return;
      ensureMode().pointerDown(p.x, p.y, e.button);
    };
    const move = (e: PointerEvent) => {
      if (!editor.hasProject || e.pointerType === 'touch') return;
      syncMods(e);
      const p = local(e);
      ensureMode().pointerMove(p.x, p.y);
    };
    // Only the left button finishes a drag: while placing a slider the right button adds a repeat, and releasing it
    // must not finish the slider.
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.button === 0) mode?.pointerUp();
    };
    // A cancelled pointer (the browser took it over) always ends the drag, without acting on it.
    const cancelPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') mode?.pointerUp();
    };
    const leave = (e: PointerEvent) => e.pointerType !== 'touch' && mode?.pointerLeave();
    const dbl = (e: MouseEvent) => {
      if (touchedRecently()) return;
      const p = local(e);
      mode?.doubleClick(p.x, p.y);
    };
    const keys = (e: KeyboardEvent) => {
      // Alt is the distance snap key; without this the browser takes it to open its own menu.
      if (e.key === 'Alt') e.preventDefault();
      if (e.altKey !== keyMods.altKey) redrawNext();
      keyMods = e;
      syncMods(e);
    };
    // Touch: a long press is the right click, placement tools preview under the finger and place on lift,
    // a two-finger horizontal swipe seeks like the wheel (swiping left moves forward in time), and a pinch changes
    // distance spacing like Alt + wheel. Placing an object moves the playhead on afterwards (see editor.advanceAfterPlace).
    let swipeSteps = 0;
    let pinchKind: 'seek' | 'spacing' | null = null;
    let ds0 = 1;
    // While placing, the cursor sits above the finger so the finger doesn't hide it, easing back to the finger
    // near the bottom edge so the bottom of the playfield stays reachable.
    const lift = (y: number) =>
      editor.hasProject && editor.tool !== 'select' ? y - CURSOR_LIFT * Math.min(1, Math.max(0, (h - y) / (CURSOR_LIFT * 2))) : y;
    const detachTouch = attachTouch(canvas, {
      hover: (x, y) => {
        if (!editor.hasProject) return;
        syncMods(keyMods);
        ensureMode().pointerMove(x, lift(y));
      },
      previewOnly: () => editor.hasProject && !!ensureMode().touchPreview?.(),
      press: (x, y, kind) => {
        if (!editor.hasProject) return;
        syncMods(keyMods);
        if (kind === 'tap' && editor.leavePlacement(ensureMode().inPlayfield?.(x, lift(y)) === false)) return;
        ensureMode().pointerDown(x, lift(y), kind === 'long' ? 2 : 0, kind === 'drag');
      },
      move: (x, y) => {
        syncMods(keyMods);
        mode?.pointerMove(x, lift(y));
      },
      release: () => mode?.pointerUp(),
      leave: () => mode?.pointerLeave(),
      doubleTap: (x, y) => mode?.doubleClick(x, y),
      multiTap: (n) => editor.hasProject && undoTap(n, () => editor.undo(), () => editor.redo()),
      pinch: {
        start: () => {
          swipeSteps = 0;
          pinchKind = null;
          ds0 = editor.hasProject ? editor.bm.editor.distanceSpacing : 1;
        },
        update: (dx, scale) => {
          if (!editor.hasProject) return;
          // Whichever moves first decides: a swipe seeks, a pinch changes distance spacing (osu! and catch only).
          const dsModes = editor.bm.general.mode === 0 || editor.bm.general.mode === 2;
          if (!pinchKind) pinchKind = dsModes && Math.abs(scale - 1) > 0.12 ? 'spacing' : Math.abs(dx) > 20 ? 'seek' : null;
          if (pinchKind === 'spacing') {
            const ds = Math.round(ds0 * scale * 10) / 10;
            if (ds !== editor.bm.editor.distanceSpacing) {
              if (!editor.prefs.distanceSnap) editor.setPrefs({ distanceSnap: true });
              editor.setDistanceSpacing(ds);
              navigator.vibrate?.(6);
            }
          } else if (pinchKind === 'seek') {
            const steps = Math.trunc(-dx / 40);
            for (; swipeSteps < steps; swipeSteps++) editor.seekTick(1);
            for (; swipeSteps > steps; swipeSteps--) editor.seekTick(-1);
          }
        },
        end: () => {
          if (pinchKind === 'spacing' && editor.hasProject && editor.bm.editor.distanceSpacing !== ds0) {
            editor.toast(`Distance spacing: ${editor.bm.editor.distanceSpacing}x`);
          }
        },
      },
    });
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancelPointer);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', keys);
    window.addEventListener('keyup', keys);
    return () => {
      off();
      ro.disconnect();
      activePlayfield.current = null;
      detachTouch();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('dblclick', dbl);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('keyup', keys);
    };
  }, []);

  return <canvas ref={canvasRef} className="playfield-canvas" data-wheel="playfield" />;
}
