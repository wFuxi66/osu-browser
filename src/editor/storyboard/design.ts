// Visual storyboard editing (Design mode): selection, keyframing at the current time, element management
// and an undo history that spans the shared .osb and the difficulty's own storyboard.
import { music } from '../../audio/music';
import { redLineAt } from '../../osu/timing';
import {
  newSbId,
  parseOsb,
  propValue,
  serializeOsb,
  spriteStateAt,
  type Prop,
  type SbCommand,
  type SbCommandType,
  type SbElement,
  type SbEntry,
  type SbLayer,
  type SbSprite,
} from '../../osu/storyboard';
import { editor } from '../store';
import { storyboard, type SbRef, type SbSource } from './runtime';

export type KeyframeType = Exclude<SbCommandType, 'P' | 'MX' | 'MY'>;

/** Design tab options for new keyframes: Tweening (ease from the previous keyframe) and Easing In/Out. */
export const keyframeStyle = { tween: true, easing: 0 };

/**
 * Set a property's value at time t the way stable's design mode keyframes: edit a command that starts/ends
 * at t, split one that spans t, or tween from the previous keyframe (or into the next one).
 */
export function setKeyframe(el: SbSprite, type: KeyframeType, t: number, values: number[]) {
  t = Math.round(t);
  const v = () => values.slice();
  const cmds = el.commands.filter((c): c is SbCommand => c.type === type).sort((a, b) => a.start - b.start);
  if (!cmds.length) {
    if (type === 'M') {
      el.x = values[0];
      el.y = values[1];
    } else {
      el.commands.push({ type, easing: 0, start: t, end: t, from: v(), to: v() });
    }
    return;
  }
  const near = (a: number) => Math.abs(a - t) <= 1;
  const atEnd = cmds.filter((c) => near(c.end));
  const atStart = cmds.filter((c) => near(c.start));
  if (atEnd.length || atStart.length) {
    for (const c of atEnd) c.to = v();
    for (const c of atStart) c.from = v();
    return;
  }
  const inside = cmds.find((c) => c.start < t && t < c.end);
  if (inside) {
    const second: SbCommand = { ...inside, start: t, from: v(), to: inside.to };
    inside.end = t;
    inside.to = v();
    el.commands.splice(el.commands.indexOf(inside) + 1, 0, second);
    return;
  }
  const { tween, easing } = keyframeStyle;
  const before = [...cmds].reverse().find((c) => c.end < t);
  if (before) {
    el.commands.push(tween ? { type, easing, start: before.end, end: t, from: before.to.slice(), to: v() } : { type, easing: 0, start: t, end: t, from: v(), to: v() });
    return;
  }
  el.commands.push(tween ? { type, easing, start: t, end: cmds[0].start, from: v(), to: cmds[0].from.slice() } : { type, easing: 0, start: t, end: t, from: v(), to: v() });
}

/** Shift a sprite's whole motion (base position and every move command) by a delta. */
export function translateSprite(el: SbSprite, dx: number, dy: number) {
  el.x += dx;
  el.y += dy;
  const shift = (c: SbCommand) => {
    if (c.type === 'M') {
      c.from = [c.from[0] + dx, c.from[1] + dy];
      c.to = [c.to[0] + dx, c.to[1] + dy];
    } else if (c.type === 'MX') {
      c.from = [c.from[0] + dx];
      c.to = [c.to[0] + dx];
    } else if (c.type === 'MY') {
      c.from = [c.from[0] + dy];
      c.to = [c.to[0] + dy];
    }
  };
  for (const c of el.commands) {
    if (c.type === 'L' || c.type === 'T') c.commands.forEach(shift);
    else shift(c);
  }
}

/**
 * Put a sprite at (x, y) at time t. Sprites moved only by loops/triggers or MX/MY can't take an M keyframe
 * without fighting those commands, so their whole path is shifted instead.
 */
export function setPositionAt(el: SbSprite, t: number, x: number, y: number, current: { x: number; y: number }) {
  const isMove = (c: SbEntry) => c.type === 'M' || c.type === 'MX' || c.type === 'MY';
  const topM = el.commands.some((c) => c.type === 'M');
  const otherMoves = el.commands.some((c) => (c.type === 'L' || c.type === 'T' ? c.commands.some(isMove) : c.type === 'MX' || c.type === 'MY'));
  if (otherMoves && !topM) translateSprite(el, Math.round(x - current.x), Math.round(y - current.y));
  else setKeyframe(el, 'M', t, [x, y]);
}

type HistoryEntry = { source: 'osb'; before: string; after?: string } | { source: 'diff' };

interface Drag {
  ref: SbRef;
  mode: 'move' | 'scale' | 'rotate' | 'fade';
  start: { x: number; y: number };
  snapshot: SbSprite;
  t: number;
}

class DesignState {
  /** Storyboard new elements go to. */
  target: SbSource = 'osb';
  selected: SbRef | null = null;
  /** Keyframe moves at the current time (stable's behaviour) instead of shifting the whole path. */
  autoKeyframe = true;
  showPlayfield = true;
  /** Design tab: what dragging a sprite changes (Transformation). */
  transform: 'move' | 'scale' | 'fade' | 'rotate' | 'colour' = 'move';
  /** Origin for new sprites. */
  newOrigin: 'TopLeft' | 'Centre' = 'TopLeft';
  /** Layer Toggles. */
  visibleLayers = new Set<SbLayer>(['Background', 'Fail', 'Pass', 'Foreground', 'Overlay']);
  showHitObjects = false;
  /** "Background Image/Video" behind the storyboard. */
  showBackground = true;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private drag: Drag | null = null;

  get selectedElement(): SbElement | undefined {
    return this.selected ? storyboard.get(this.selected) : undefined;
  }

  select(ref: SbRef | null) {
    this.selected = ref;
    editor.emit();
  }

  /** Run an edit on one storyboard source as an undoable step and save it to the project. */
  edit(source: SbSource, fn: () => void) {
    const before = source === 'osb' ? serializeOsb(storyboard.osb) : '';
    fn();
    for (const el of storyboard[source].elements) storyboard.invalidate(el);
    storyboard.save(source);
    this.undoStack.push(source === 'osb' ? { source, before } : { source });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    editor.emit();
  }

  editSelected(fn: (el: SbElement) => void) {
    const ref = this.selected;
    const el = this.selectedElement;
    if (!ref || !el) return;
    this.edit(ref.source, () => fn(el));
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    if (e.source === 'osb') {
      const now = serializeOsb(storyboard.osb);
      storyboard.osb = parseOsb(e.before);
      storyboard.save('osb');
      this.redoStack.push({ source: 'osb', before: e.before, after: now });
    } else {
      editor.undo();
      this.redoStack.push(e);
    }
    this.pruneSelection();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    if (e.source === 'osb') {
      storyboard.osb = parseOsb(e.after!);
      storyboard.save('osb');
    } else {
      editor.redo();
    }
    this.undoStack.push(e);
    this.pruneSelection();
  }

  private pruneSelection() {
    if (this.selected && !storyboard.get(this.selected)) this.selected = null;
    editor.emit();
  }

  // ---------------------------------------------------------------- keyframe control (Design tab)

  private get keyframeType(): KeyframeType {
    return ({ move: 'M', scale: 'S', fade: 'F', rotate: 'R', colour: 'C' } as const)[this.transform];
  }

  /** "+": add a keyframe for the active transformation at the current time, keeping the current value. */
  addKeyframe() {
    const el = this.selectedElement;
    if (!el || el.kind === 'sample') return;
    const t = Math.round(music.time);
    const c = storyboard.compiledFor(el);
    const v = (p: Prop, i = 0, fb = 0) => Math.round(propValue(c, p, t, i, fb) * 1000) / 1000;
    const type = this.keyframeType;
    const values =
      type === 'M' ? [v('x', 0, el.x), v('y', 0, el.y)]
      : type === 'S' ? [v('scale', 0, 1)]
      : type === 'F' ? [v('alpha', 0, 1)]
      : type === 'R' ? [v('rotation')]
      : [v('colour', 0, 255), v('colour', 1, 255), v('colour', 2, 255)];
    this.editSelected((x) => x.kind !== 'sample' && setKeyframe(x, type, t, values));
  }

  /** "−": remove the active transformation's keyframe at the current time, joining the commands around it. */
  removeKeyframe() {
    const el = this.selectedElement;
    if (!el || el.kind === 'sample') return;
    const t = Math.round(music.time);
    const type = this.keyframeType;
    this.editSelected((x) => {
      if (x.kind === 'sample') return;
      const cmds = x.commands.filter((c): c is SbCommand => c.type === type);
      const near = (a: number) => Math.abs(a - t) <= 2;
      const ending = cmds.find((c) => near(c.end) && !near(c.start));
      const starting = cmds.find((c) => near(c.start) && !near(c.end));
      if (ending && starting) {
        ending.end = starting.end;
        ending.to = starting.to;
        x.commands = x.commands.filter((c) => c !== starting);
      } else {
        x.commands = x.commands.filter((c) => !(c.type === type && (near((c as SbCommand).start) || near((c as SbCommand).end))));
      }
    });
  }

  /** "|◀" / "▶|": seek to the selected sprite's previous / next keyframe. */
  seekKeyframe(dir: 1 | -1) {
    const el = this.selectedElement;
    if (!el || el.kind === 'sample') return;
    const c = storyboard.compiledFor(el);
    const times = new Set<number>();
    for (const segs of Object.values(c.timelines)) for (const s of segs ?? []) times.add(Math.round(s.start)).add(Math.round(s.end));
    const t = music.time;
    const sorted = [...times].sort((a, b) => a - b);
    const target = dir > 0 ? sorted.find((x) => x > t + 1) : [...sorted].reverse().find((x) => x < t - 1);
    if (target !== undefined) music.seek(target);
  }

  /** Design → Move all elements in time: shift every command, loop, trigger and sample of both storyboards. */
  shiftAllInTime(ms: number) {
    const shiftEntry = (e: SbEntry) => {
      e.start += ms;
      if (e.type === 'T') e.end += ms;
      if (e.type !== 'L' && e.type !== 'T') e.end += ms;
    };
    for (const source of ['osb', 'diff'] as SbSource[]) {
      const els = storyboard[source].elements;
      if (!els.length) continue;
      this.edit(source, () => {
        for (const el of els) {
          if (el.kind === 'sample') el.time += ms;
          else el.commands.forEach(shiftEntry);
        }
      });
    }
  }

  // ---------------------------------------------------------------- element management

  /** Default lifetime for new sprites: four measures from now. */
  private defaultDuration(t: number) {
    const red = redLineAt(editor.bm, t);
    return red.beatLength > 0 ? Math.round(red.beatLength * red.meter * 4) : 4000;
  }

  addSprite(file: string, x = 320, y = 240, layer: SbLayer = 'Foreground', animation?: { frameCount: number; frameDelay: number }) {
    const t = Math.round(music.time);
    const el: SbSprite = {
      kind: animation ? 'animation' : 'sprite',
      id: newSbId(),
      layer,
      origin: this.newOrigin,
      file,
      x: Math.round(x),
      y: Math.round(y),
      frameCount: animation?.frameCount ?? 1,
      frameDelay: animation?.frameDelay ?? 0,
      loopForever: true,
      commands: [{ type: 'F', easing: 0, start: t, end: t + this.defaultDuration(t), from: [1], to: [1] }],
    };
    const source = this.target;
    this.edit(source, () => storyboard[source].elements.push(el));
    this.select({ source, index: storyboard[source].elements.indexOf(el) });
  }

  addSample(file: string) {
    const source = this.target;
    const el: SbElement = { kind: 'sample', id: newSbId(), time: Math.round(music.time), layer: 'Background', file, volume: 100 };
    this.edit(source, () => storyboard[source].elements.push(el));
    this.select({ source, index: storyboard[source].elements.indexOf(el) });
  }

  deleteSelected() {
    const ref = this.selected;
    if (!ref) return;
    this.edit(ref.source, () => storyboard[ref.source].elements.splice(ref.index, 1));
    this.select(null);
  }

  duplicateSelected() {
    const ref = this.selected;
    const el = this.selectedElement;
    if (!ref || !el) return;
    const copy = { ...structuredClone(el), id: newSbId() };
    this.edit(ref.source, () => storyboard[ref.source].elements.splice(ref.index + 1, 0, copy));
    this.select({ source: ref.source, index: ref.index + 1 });
  }

  /** Move within the source's element list (draw order inside a layer). */
  reorderSelected(delta: number) {
    const ref = this.selected;
    if (!ref) return;
    const els = storyboard[ref.source].elements;
    const to = Math.max(0, Math.min(els.length - 1, ref.index + delta));
    if (to === ref.index) return;
    this.edit(ref.source, () => els.splice(to, 0, ...els.splice(ref.index, 1)));
    this.select({ source: ref.source, index: to });
  }

  /** Move the selected element to the other storyboard (.osb ⇄ difficulty). */
  moveSelectedToOtherSource() {
    const ref = this.selected;
    const el = this.selectedElement;
    if (!ref || !el) return;
    const other: SbSource = ref.source === 'osb' ? 'diff' : 'osb';
    this.edit(ref.source, () => storyboard[ref.source].elements.splice(ref.index, 1));
    this.edit(other, () => storyboard[other].elements.push(el));
    this.select({ source: other, index: storyboard[other].elements.length - 1 });
  }

  // ---------------------------------------------------------------- dragging on the preview

  beginDrag(ref: SbRef, p: { x: number; y: number }, mode: Drag['mode']) {
    const el = storyboard.get(ref);
    if (!el || el.kind === 'sample') return;
    this.drag = { ref, mode, start: p, snapshot: structuredClone(el), t: Math.round(music.time) };
  }

  get dragging() {
    return this.drag !== null;
  }

  dragTo(p: { x: number; y: number }) {
    const d = this.drag;
    if (!d) return;
    const el = storyboard.get(d.ref);
    if (!el || el.kind === 'sample') return;
    // Recompute from the snapshot so every move is applied to the original state.
    el.x = d.snapshot.x;
    el.y = d.snapshot.y;
    el.commands = structuredClone(d.snapshot.commands);
    storyboard.invalidate(el);
    const state = spriteStateAt(storyboard.compiledFor(el), d.t);
    const dx = Math.round(p.x - d.start.x);
    const dy = Math.round(p.y - d.start.y);
    if (d.mode === 'move') {
      if (this.autoKeyframe && state) setPositionAt(el, d.t, Math.round(state.x + dx), Math.round(state.y + dy), state);
      else translateSprite(el, dx, dy);
    } else if (state) {
      const sx = state.x;
      const sy = state.y;
      if (d.mode === 'scale') {
        const base = Math.hypot(d.start.x - sx, d.start.y - sy) || 1;
        const k = Math.hypot(p.x - sx, p.y - sy) / base;
        const s = propValue(storyboard.compiledFor(el), 'scale', d.t, 0, 1);
        setKeyframe(el, 'S', d.t, [Math.round(Math.max(0.001, s * k) * 1000) / 1000]);
      } else if (d.mode === 'fade') {
        // Drag up to fade in, down to fade out.
        const a = propValue(storyboard.compiledFor(el), 'alpha', d.t, 0, 1);
        setKeyframe(el, 'F', d.t, [Math.round(Math.max(0, Math.min(1, a - dy / 200)) * 1000) / 1000]);
      } else {
        const a0 = Math.atan2(d.start.y - sy, d.start.x - sx);
        const a1 = Math.atan2(p.y - sy, p.x - sx);
        setKeyframe(el, 'R', d.t, [Math.round((state.rotation + a1 - a0) * 1000) / 1000]);
      }
    }
    storyboard.invalidate(el);
    editor.emit();
  }

  endDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const el = storyboard.get(d.ref);
    if (!el || el.kind === 'sample') return;
    const changed = JSON.stringify(el.commands) !== JSON.stringify(d.snapshot.commands) || el.x !== d.snapshot.x || el.y !== d.snapshot.y;
    if (!changed) return;
    // Record the undo step against the pre-drag state.
    const after = structuredClone(el);
    Object.assign(el, { x: d.snapshot.x, y: d.snapshot.y, commands: d.snapshot.commands });
    this.edit(d.ref.source, () => Object.assign(el, { x: after.x, y: after.y, commands: after.commands }));
  }

  cancelDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const el = storyboard.get(d.ref);
    if (el && el.kind !== 'sample') {
      Object.assign(el, { x: d.snapshot.x, y: d.snapshot.y, commands: d.snapshot.commands });
      storyboard.invalidate(el);
    }
    editor.emit();
  }
}

export const design = new DesignState();
