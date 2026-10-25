// Touch input: the touch-device flag, sticky modifier toggles (no Shift/Ctrl/Alt on a phone), and the gesture
// recogniser that turns taps, drags, long presses and two-finger moves into the mouse actions the editor knows.
import { useSyncExternalStore } from 'react';

const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
let touchDevice = coarse?.matches ?? false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const emit = () => listeners.forEach((l) => l());

/** `[data-touch]` on <html> lets the stylesheets enlarge tap targets on touch screens only. */
function applyFlag() {
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-touch', touchDevice);
}
applyFlag();
coarse?.addEventListener('change', (e) => {
  touchDevice = e.matches;
  applyFlag();
  emit();
});

/** True when the primary pointer is a finger: the touch toolbar and enlarged controls are shown. */
export function useTouch() {
  return useSyncExternalStore(subscribe, () => touchDevice);
}

export interface TouchMods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

let mods: TouchMods = { shift: false, ctrl: false, alt: false };

/** Modifier keys held down from the touch toolbar; they stay on until tapped again. */
export const touchMods = {
  get: () => mods,
  toggle(k: keyof TouchMods) {
    mods = { ...mods, [k]: !mods[k] };
    emit();
  },
};

export function useTouchMods() {
  return useSyncExternalStore(subscribe, () => mods);
}

let lastTouchAt = -Infinity;

/** Two-finger tap undoes, three-finger tap redoes (the drawing-app convention). */
export function undoTap(fingers: number, undo: () => void, redo: () => void) {
  if (fingers === 2) undo();
  else if (fingers === 3) redo();
  else return;
  navigator.vibrate?.(10);
}

/** The browser's own dblclick after two taps is ignored: TouchGesture reports double taps itself. */
export function touchedRecently() {
  return performance.now() - lastTouchAt < 1000;
}

// ------------------------------------------------------------------ gestures

export const TAP_SLOP = 10;
export const LONG_PRESS_MS = 450;
export const DOUBLE_TAP_MS = 300;
/** A two- or three-finger touch shorter than this that barely moves is a multi-finger tap. */
export const MULTI_TAP_MS = 300;

/** How a press started: a quick tap, a drag past the slop, or a finger held still (the right click). */
export type PressKind = 'tap' | 'drag' | 'long';

export interface GestureHandlers {
  /** The finger is over (x, y) without pressing: placement previews follow it. */
  hover?(x: number, y: number): void;
  /** When true, dragging only moves the preview and the press happens where the finger lifts. */
  previewOnly?(): boolean;
  press(x: number, y: number, kind: PressKind): void;
  move(x: number, y: number): void;
  release(): void;
  /** The finger is gone: clear previews. */
  leave?(): void;
  doubleTap?(x: number, y: number): void;
  /** Two fingers: `dx` is how far their midpoint moved, `scale` the change in their spread. */
  pinch?: { start(): void; update(dx: number, scale: number): void; end(): void };
  /** Two or three fingers tapped together (undo / redo). */
  multiTap?(fingers: number): void;
}

type State = 'idle' | 'pending' | 'preview' | 'pressed' | 'pinch';

/** One-finger and two-finger recogniser, fed with pointer samples and timestamps (pure, so it can be tested). */
export class TouchGesture {
  private state: State = 'idle';
  private start = { x: 0, y: 0, t: 0 };
  private last = { x: 0, y: 0 };
  private moved = false;
  private fingers = new Map<number, { x: number; y: number }>();
  private pinch0 = { mid: 0, dist: 1 };
  private multi = { t: 0, fingers: 0, moved: false };
  private lastTap = { x: 0, y: 0, t: -Infinity };

  constructor(private h: GestureHandlers) {}

  down(id: number, x: number, y: number, now: number) {
    this.fingers.set(id, { x, y });
    if (this.state === 'pinch') this.multi.fingers = Math.max(this.multi.fingers, this.fingers.size);
    if (this.fingers.size === 2 && this.h.pinch) {
      // A finger already pressing something isn't the start of a tap.
      this.multi = { t: now, fingers: 2, moved: this.state === 'pressed' || now - this.start.t > MULTI_TAP_MS };
      if (this.state === 'pressed') this.h.release();
      if (this.state !== 'idle') this.h.leave?.();
      this.state = 'pinch';
      this.pinch0 = this.spread();
      this.h.pinch.start();
      return;
    }
    if (this.fingers.size !== 1) return;
    this.start = { x, y, t: now };
    this.last = { x, y };
    this.moved = false;
    this.state = this.h.previewOnly?.() ? 'preview' : 'pending';
    this.h.hover?.(x, y);
  }

  move(id: number, x: number, y: number) {
    const f = this.fingers.get(id);
    if (!f) return;
    f.x = x;
    f.y = y;
    if (this.state === 'pinch') {
      if (this.fingers.size < 2) return;
      const s = this.spread();
      if (Math.abs(s.mid - this.pinch0.mid) > TAP_SLOP || Math.abs(s.dist / this.pinch0.dist - 1) > 0.1) this.multi.moved = true;
      this.h.pinch!.update(s.mid - this.pinch0.mid, s.dist / this.pinch0.dist);
      return;
    }
    if (this.fingers.size !== 1) return;
    this.last = { x, y };
    if (Math.hypot(x - this.start.x, y - this.start.y) > TAP_SLOP) this.moved = true;
    if (this.state === 'preview') this.h.hover?.(x, y);
    else if (this.state === 'pending' && this.moved) {
      this.state = 'pressed';
      this.h.press(this.start.x, this.start.y, 'drag');
      this.h.move(x, y);
    } else if (this.state === 'pressed') this.h.move(x, y);
  }

  /** Call when LONG_PRESS_MS may have passed; returns true when it fired the long press. */
  tick(now: number): boolean {
    if ((this.state !== 'pending' && this.state !== 'preview') || this.moved) return false;
    if (now - this.start.t < LONG_PRESS_MS - 5) return false;
    this.state = 'pressed';
    this.h.press(this.start.x, this.start.y, 'long');
    return true;
  }

  up(id: number, now: number) {
    if (!this.fingers.delete(id)) return;
    if (this.state === 'pinch') {
      if (this.fingers.size === 0) {
        this.h.pinch!.end();
        this.state = 'idle';
        const m = this.multi;
        if (!m.moved && now - m.t < MULTI_TAP_MS) this.h.multiTap?.(m.fingers);
      }
      return;
    }
    if (this.state === 'pending' || this.state === 'preview') {
      const p = this.state === 'pending' ? this.start : this.last;
      this.h.press(p.x, p.y, 'tap');
      this.h.release();
      this.h.leave?.();
      this.state = 'idle';
      this.tapped(p.x, p.y, now);
      return;
    }
    if (this.state === 'pressed') {
      this.h.release();
      this.h.leave?.();
    }
    this.state = 'idle';
  }

  /** The browser took the touch over (pointercancel): end without acting. */
  cancel(id: number) {
    if (!this.fingers.delete(id)) return;
    if (this.state === 'pinch') {
      if (this.fingers.size === 0) this.h.pinch!.end();
      else return;
    } else if (this.state === 'pressed') this.h.release();
    if (this.state !== 'idle') this.h.leave?.();
    this.state = 'idle';
  }

  private tapped(x: number, y: number, now: number) {
    const lt = this.lastTap;
    if (now - lt.t < DOUBLE_TAP_MS && Math.hypot(x - lt.x, y - lt.y) < TAP_SLOP * 2.5) {
      this.h.doubleTap?.(x, y);
      this.lastTap = { x: 0, y: 0, t: -Infinity };
    } else this.lastTap = { x, y, t: now };
  }

  private spread() {
    const [a, b] = [...this.fingers.values()];
    return { mid: (a.x + b.x) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
}

/**
 * Feeds `el`'s touch pointers (only those: mouse and pen keep their own handlers) to a TouchGesture, in
 * element-local coordinates. Returns the detach function.
 */
export function attachTouch(el: HTMLElement, h: GestureHandlers): () => void {
  const g = new TouchGesture(h);
  let timer = 0;
  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    lastTouchAt = performance.now();
    el.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    g.down(e.pointerId, x, y, performance.now());
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (g.tick(performance.now())) navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const [x, y] = local(e);
    g.move(e.pointerId, x, y);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    lastTouchAt = performance.now();
    g.up(e.pointerId, performance.now());
  };
  const cancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch') g.cancel(e.pointerId);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    clearTimeout(timer);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
