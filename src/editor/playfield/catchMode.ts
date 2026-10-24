// osu!catch compose surface: a vertically scrolling playfield (x across, time upwards) with fruits, juice
// streams and banana showers, hyperdash highlighting and catch-style distance snap.
import { music } from '../../audio/music';
import {
  catcherWidth,
  catchObjects,
  CATCH_WIDTH,
  fruitRadius,
  juiceStreamPath,
  markHyperdashes,
  sliderVelocity,
  type CatchObject,
} from '../../osu/catch';
import { comboColourIndex } from '../../osu/processing';
import { redLineAt } from '../../osu/timing';
import { DEFAULT_COMBO_COLOURS, defaultSample, newObjectId, type HitObject, type Rgb } from '../../osu/types';
import { rgba, shade } from '../render/draw';
import { editor, shiftObjectTime, translateObject } from '../store';
import { drawBeatLines } from './scrolling';
import { distanceSnapActive, expectedDistance, type Modifiers } from './snapping';
import type { PlayfieldMode } from './types';

type Drag =
  | { kind: 'move'; startTime: number; startX: number; originals: Map<number, HitObject>; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean }
  | { kind: 'banana'; start: number; end: number };

export class CatchMode implements PlayfieldMode {
  mods: Modifiers = { shift: false, alt: false, ctrl: false };
  private h = 0;
  private left = 0;
  private scale = 1;
  private judgeY = 0;
  private hover: { x: number; y: number } | null = null;
  private drag: Drag | null = null;
  /** Juice stream being placed: (time, x) vertices. */
  private stream: { time: number; x: number }[] | null = null;
  private cache: { rev: number; objects: CatchObject[] } | null = null;

  get pxPerMs() {
    return 0.8 * (this.h / 700) * editor.bm.editor.timelineZoom;
  }

  layout(w: number, h: number) {
    this.h = h;
    const pfW = Math.max(200, Math.min(w - 60, h * 1.15));
    this.scale = pfW / CATCH_WIDTH;
    this.left = (w - pfW) / 2;
    this.judgeY = h - 56;
  }

  private objects(): CatchObject[] {
    if (!this.cache || this.cache.rev !== editor.contentRev) {
      const objects = catchObjects(editor.bm);
      markHyperdashes(objects, editor.bm.difficulty.circleSize);
      this.cache = { rev: editor.contentRev, objects };
    }
    return this.cache.objects;
  }

  private timeAtY(y: number, t: number) {
    return t + (this.judgeY - y) / this.pxPerMs;
  }
  private yAtTime(time: number, t: number) {
    return this.judgeY - (time - t) * this.pxPerMs;
  }
  private sx(x: number) {
    return this.left + x * this.scale;
  }
  private osuX(px: number) {
    return (px - this.left) / this.scale;
  }

  private comboColour(o: HitObject): Rgb {
    const cols = editor.bm.colours.combo.length ? editor.bm.colours.combo : DEFAULT_COMBO_COLOURS;
    return cols[comboColourIndex(editor.bm, o, editor.processed) % cols.length];
  }

  // ------------------------------------------------------------------ snapping

  /** The last catchable object before `time` (ignoring objects being dragged). */
  private previous(time: number, exclude?: Set<number>): CatchObject | null {
    const objs = this.objects();
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.kind === 'banana' || o.kind === 'tiny' || exclude?.has(o.parent.id)) continue;
      if (o.time < time - 0.5) return o;
    }
    return null;
  }

  /** Catch distance snap: put the object exactly the expected distance left or right of the previous one. */
  private snapX(x: number, time: number, exclude?: Set<number>): number {
    x = Math.max(0, Math.min(CATCH_WIDTH, x));
    if (distanceSnapActive(this.mods)) {
      const prev = this.previous(time, exclude);
      if (prev) {
        const d = expectedDistance(prev.time, time);
        const options = [prev.x - d, prev.x + d].filter((v) => v >= 0 && v <= CATCH_WIDTH);
        if (options.length) x = options.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
      }
    }
    return Math.round(x);
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const bm = editor.bm;
    const x0 = this.sx(0);
    const x1 = this.sx(CATCH_WIDTH);
    const tStart = this.timeAtY(this.h + 50, t);
    const tEnd = this.timeAtY(-50, t);
    const r = Math.max(4, fruitRadius(bm.difficulty.circleSize) * this.scale);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, 0, x1 - x0, this.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, -1, x1 - x0, this.h + 2);
    drawBeatLines(ctx, bm, editor.beatDivisor, tStart, tEnd, (time) => this.yAtTime(time, t), x0, x1);

    const objs = this.objects();
    // Juice stream bodies and banana shower bands first.
    for (const o of bm.hitObjects) {
      const end = editor.processed.info.get(o.id)?.endTime ?? o.time;
      if (end < tStart || o.time > tEnd) continue;
      const sel = editor.selection.has(o.id);
      if (o.kind === 'spinner') {
        const ya = this.yAtTime(o.time, t);
        const yb = this.yAtTime(o.endTime, t);
        ctx.fillStyle = sel ? 'rgba(255,212,0,0.22)' : 'rgba(255,220,80,0.1)';
        ctx.fillRect(x0, yb, x1 - x0, ya - yb);
      } else if (o.kind === 'slider') {
        const parts = objs.filter((c) => c.parent === o);
        ctx.strokeStyle = sel ? '#ffd400' : rgba(this.comboColour(o), 0.55);
        ctx.lineWidth = Math.max(2, r * 0.35);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        parts.forEach((c, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, this.sx(c.x), this.yAtTime(c.time, t)));
        ctx.stroke();
      }
    }
    // Nested objects (binary search for the visible window).
    let lo = 0;
    let hi = objs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (objs[mid].time < tStart) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < objs.length && objs[i].time <= tEnd; i++) {
      const c = objs[i];
      this.drawCatchObject(ctx, c, this.sx(c.x), this.yAtTime(c.time, t), r, editor.selection.has(c.parent.id), c.time < t);
    }

    this.drawCatcher(ctx, t, objs);

    // Placement previews
    const tool = editor.tool;
    if (this.drag?.kind === 'banana') {
      const ya = this.yAtTime(this.drag.start, t);
      const yb = this.yAtTime(Math.max(this.drag.start, this.drag.end), t);
      ctx.fillStyle = 'rgba(255,220,80,0.25)';
      ctx.fillRect(x0, yb, x1 - x0, ya - yb);
    } else if (this.stream) {
      const pts = [...this.stream];
      if (this.hover) {
        const time = Math.round(editor.snap(this.timeAtY(this.hover.y, t)));
        if (time > pts[pts.length - 1].time) pts.push({ time, x: this.osuX(this.hover.x) });
      }
      const path = this.previewStream(pts);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      path.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, this.sx(p.x), this.yAtTime(p.time, t)));
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of path) this.drawFruitShape(ctx, this.sx(p.x), this.yAtTime(p.time, t), r * 0.6, { r: 255, g: 255, b: 255 }, 0.6);
    } else if (this.hover && !this.drag && (tool === 'circle' || tool === 'slider')) {
      const time = Math.round(editor.snap(this.timeAtY(this.hover.y, t)));
      const x = this.snapX(this.osuX(this.hover.x), time);
      this.drawDistanceGuide(ctx, t, time);
      this.drawFruitShape(ctx, this.sx(x), this.yAtTime(time, t), r, { r: 255, g: 255, b: 255 }, 0.45);
    }
    if (this.drag?.kind === 'box') {
      const d = this.drag;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    ctx.restore();
  }

  /** The V of reachable distance-snap positions from the previous object. */
  private drawDistanceGuide(ctx: CanvasRenderingContext2D, t: number, time: number) {
    if (!distanceSnapActive(this.mods)) return;
    const prev = this.previous(time);
    if (!prev) return;
    const y0 = this.yAtTime(prev.time, t);
    const tTop = this.timeAtY(0, t);
    const d = expectedDistance(prev.time, tTop);
    ctx.save();
    ctx.strokeStyle = 'rgba(102,204,255,0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (const dir of [-1, 1]) {
      ctx.moveTo(this.sx(prev.x), y0);
      ctx.lineTo(this.sx(prev.x + dir * d), 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  private previewStream(pts: { time: number; x: number }[]): { time: number; x: number }[] {
    if (pts.length < 2) return pts;
    const vel = sliderVelocity(editor.bm, pts[0].time);
    const out = [pts[0]];
    let x = pts[0].x;
    for (let i = 1; i < pts.length; i++) {
      const dd = (pts[i].time - pts[i - 1].time) * vel;
      x += Math.max(-dd, Math.min(dd, pts[i].x - x));
      out.push({ time: pts[i].time, x: Math.max(0, Math.min(CATCH_WIDTH, x)) });
    }
    return out;
  }

  private drawCatchObject(ctx: CanvasRenderingContext2D, c: CatchObject, x: number, y: number, r: number, selected: boolean, past: boolean) {
    const colour = this.comboColour(c.parent);
    const alpha = past ? 0.5 : 1;
    if (c.kind === 'banana') {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = selected ? '#ffd400' : '#ffe14d';
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y - r * 0.2, r * 0.55, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (c.kind === 'tiny') {
      ctx.fillStyle = rgba(shade(colour, 0.3), 0.8 * alpha);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, r * 0.18), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (c.kind === 'droplet') {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = rgba(colour);
      ctx.strokeStyle = c.hyper ? '#ff3344' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = c.hyper ? 3 : 1.5;
      const dr = r * 0.42;
      ctx.beginPath();
      ctx.moveTo(x, y - dr * 1.5);
      ctx.quadraticCurveTo(x + dr * 1.1, y, x, y + dr);
      ctx.quadraticCurveTo(x - dr * 1.1, y, x, y - dr * 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      if (c.hyper) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(255,40,60,0.35)';
        ctx.beginPath();
        ctx.arc(x, y, r * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      this.drawFruitShape(ctx, x, y, r, colour, alpha, c.hyper);
    }
    if (selected) {
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, (c.kind === 'droplet' ? r * 0.65 : r) + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawFruitShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: Rgb, alpha: number, hyper = false) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, rgba(shade(colour, 0.45)));
    g.addColorStop(1, rgba(shade(colour, -0.15)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hyper ? '#ff3344' : '#fff';
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.stroke();
    // Leaf
    ctx.fillStyle = '#6fd46f';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.22, y - r * 0.82, r * 0.25, r * 0.11, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** The catcher plate on the judgement line, following the last caught object. */
  private drawCatcher(ctx: CanvasRenderingContext2D, t: number, objs: CatchObject[]) {
    let prev: CatchObject | null = null;
    let next: CatchObject | null = null;
    for (const o of objs) {
      if (o.kind === 'tiny') continue;
      if (o.time <= t) prev = o;
      else {
        next = o;
        break;
      }
    }
    let x = prev?.x ?? next?.x ?? CATCH_WIDTH / 2;
    if (prev && next && next.time > prev.time && t > prev.time) {
      // Move towards the next object at walking speed, like the catcher would.
      const maxMove = (t - prev.time) * 0.5;
      x = prev.x + Math.max(-maxMove, Math.min(maxMove, next.x - prev.x));
    }
    const cw = catcherWidth(editor.bm.difficulty.circleSize) * this.scale;
    const cx = this.sx(x);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, this.judgeY, cw, 10, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(this.sx(0), this.judgeY);
    ctx.lineTo(this.sx(CATCH_WIDTH), this.judgeY);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ interaction

  private hitTest(px: number, py: number, t: number): HitObject | null {
    const r = Math.max(6, fruitRadius(editor.bm.difficulty.circleSize) * this.scale);
    let best: { o: HitObject; d: number } | null = null;
    for (const c of this.objects()) {
      if (c.kind === 'tiny') continue;
      const y = this.yAtTime(c.time, t);
      if (y < -r || y > this.h + r) continue;
      const d = Math.hypot(this.sx(c.x) - px, y - py);
      const reach = c.kind === 'banana' ? r * 0.7 : c.kind === 'droplet' ? r * 0.8 : r;
      if (d <= reach && (!best || d < best.d)) best = { o: c.parent, d };
    }
    if (best) return best.o;
    // Clicking inside a banana shower band selects the spinner.
    const time = this.timeAtY(py, t);
    const x = this.osuX(px);
    if (x >= 0 && x <= CATCH_WIDTH) for (const o of editor.bm.hitObjects) if (o.kind === 'spinner' && time >= o.time && time <= o.endTime) return o;
    return null;
  }

  pointerDown(x: number, y: number, button: number) {
    const t = music.time;
    if (this.stream) {
      if (button === 2) this.finishStream();
      else if (button === 0) this.addStreamVertex(x, y, t);
      return;
    }
    const hit = this.hitTest(x, y, t);
    if (button === 2) {
      if (hit) editor.deleteObject(hit.id);
      return;
    }
    if (button !== 0) return;
    const tool = editor.tool;
    if (tool === 'select' || hit) {
      if (!hit) {
        this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, additive: this.mods.ctrl || this.mods.shift };
        if (!this.drag.additive) editor.clearSelection();
        return;
      }
      if (this.mods.ctrl || this.mods.shift) {
        editor.toggleSelect(hit.id);
        return;
      }
      if (!editor.selection.has(hit.id)) editor.select([hit.id]);
      if (tool !== 'select') {
        editor.setTool('select');
        editor.select([hit.id]);
      }
      if (editor.locked) return;
      const originals = new Map<number, HitObject>();
      for (const o of editor.selectedObjects) originals.set(o.id, structuredClone(o));
      editor.beginChange();
      this.drag = { kind: 'move', startTime: editor.snap(this.timeAtY(y, t)), startX: this.osuX(x), originals, moved: false };
      return;
    }
    const time = Math.round(editor.snap(this.timeAtY(y, t)));
    if (tool === 'circle') {
      this.placeFruit(this.snapX(this.osuX(x), time), time);
    } else if (tool === 'slider') {
      this.stream = [{ time, x: this.snapX(this.osuX(x), time) }];
      editor.placing = { kind: 'slider', vertices: [], time };
      editor.emit();
    } else if (tool === 'spinner') {
      this.drag = { kind: 'banana', start: time, end: time };
    }
  }

  private addStreamVertex(x: number, y: number, t: number) {
    const s = this.stream!;
    const time = Math.round(editor.snap(this.timeAtY(y, t)));
    if (time <= s[s.length - 1].time) return;
    s.push({ time, x: Math.round(Math.max(0, Math.min(CATCH_WIDTH, this.osuX(x)))) });
  }

  private sampleForPlacement() {
    const pl = editor.placement;
    const sample = defaultSample();
    sample.normalSet = pl.normalSet;
    sample.additionSet = pl.additionSet;
    return { sample, hitSound: (pl.whistle ? 2 : 0) | (pl.finish ? 4 : 0) | (pl.clap ? 8 : 0) };
  }

  private placeFruit(x: number, time: number) {
    const { sample, hitSound } = this.sampleForPlacement();
    editor.addObject({ kind: 'circle', id: newObjectId(), x, y: 192, time, newCombo: editor.placement.newCombo, comboSkip: 0, hitSound, sample });
  }

  /** Turn the placed vertices into a juice stream (needs at least two). */
  private finishStream() {
    const s = this.stream;
    this.stream = null;
    editor.placing = null;
    if (!s || s.length < 2) {
      editor.emit();
      return;
    }
    const bm = editor.bm;
    const { head, points, length } = juiceStreamPath(s, sliderVelocity(bm, s[0].time));
    const { sample, hitSound } = this.sampleForPlacement();
    const slider: HitObject = {
      kind: 'slider',
      id: newObjectId(),
      x: head.x,
      y: head.y,
      time: s[0].time,
      newCombo: editor.placement.newCombo,
      comboSkip: 0,
      hitSound,
      sample,
      curveType: 'L',
      // Linear segments with every vertex a red anchor.
      points: points.flatMap((p, i) => (i < points.length - 1 ? [p, { ...p }] : [p])),
      slides: 1,
      length,
      edgeSounds: [hitSound, hitSound],
      edgeSets: [
        { normal: 0, addition: 0 },
        { normal: 0, addition: 0 },
      ],
    };
    editor.addObject(slider);
  }

  pointerMove(x: number, y: number) {
    this.hover = { x, y };
    const d = this.drag;
    if (!d) return;
    const t = music.time;
    if (d.kind === 'banana') {
      d.end = Math.round(editor.snap(this.timeAtY(y, t)));
    } else if (d.kind === 'box') {
      d.x1 = x;
      d.y1 = y;
      const xa = this.osuX(Math.min(d.x0, d.x1));
      const xb = this.osuX(Math.max(d.x0, d.x1));
      const ta = this.timeAtY(Math.max(d.y0, d.y1), t);
      const tb = this.timeAtY(Math.min(d.y0, d.y1), t);
      const ids = new Set<number>();
      for (const c of this.objects()) if (c.kind !== 'tiny' && c.x >= xa && c.x <= xb && c.time >= ta && c.time <= tb) ids.add(c.parent.id);
      editor.select(ids, d.additive);
    } else if (d.kind === 'move') {
      const time = editor.snap(this.timeAtY(y, t));
      const dt = Math.round(time - d.startTime);
      const first = [...d.originals.values()].sort((a, b) => a.time - b.time)[0];
      // Distance snap applies to the earliest dragged object; the rest keep their offsets.
      const rawX = first.x + this.osuX(x) - d.startX;
      const exclude = new Set(d.originals.keys());
      let dx = Math.round(this.snapX(rawX, first.time + dt, exclude) - first.x);
      const xs = [...d.originals.values()].filter((o) => o.kind !== 'spinner').map((o) => o.x);
      if (xs.length) dx = Math.max(-Math.min(...xs), Math.min(CATCH_WIDTH - Math.max(...xs), dx));
      for (const o of editor.bm.hitObjects) {
        const orig = d.originals.get(o.id);
        if (!orig) continue;
        Object.assign(o, structuredClone(orig));
        shiftObjectTime(o, dt);
        translateObject(o, dx, 0);
      }
      if (dt || dx) d.moved = true;
      editor.touch();
    }
  }

  pointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'move') {
      if (d.moved) editor.endChange();
      else editor.cancelChange();
    } else if (d.kind === 'banana') {
      const end = d.end > d.start ? d.end : Math.round(d.start + redLineAt(editor.bm, d.start).beatLength * 2);
      const { sample, hitSound } = this.sampleForPlacement();
      editor.addObject({ kind: 'spinner', id: newObjectId(), x: 256, y: 192, time: d.start, endTime: end, newCombo: true, comboSkip: 0, hitSound, sample });
    }
  }

  pointerLeave() {
    this.hover = null;
  }

  doubleClick(x: number, y: number) {
    if (this.stream) return this.finishStream();
    const hit = this.hitTest(x, y, music.time);
    if (hit) music.seek(hit.time);
  }

  cancel() {
    if (this.stream) {
      this.stream = null;
      editor.placing = null;
      editor.emit();
      return true;
    }
    if (this.drag?.kind === 'banana') {
      this.drag = null;
      return true;
    }
    return false;
  }

  commitPlacement() {
    if (this.stream) this.finishStream();
  }
}
