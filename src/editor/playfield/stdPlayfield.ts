// osu!standard / osu!catch compose playfield: rendering and mouse interaction.
import { music } from '../../audio/music';
import { autoCurveType, computeRawPath, dist, getSliderPath, sliderPositionAtSpan } from '../../osu/curves';
import { comboColourIndex, sliderTickProgresses, stackedPosition } from '../../osu/processing';
import { sliderSpanDuration } from '../../osu/timing';
import { comboColours, sliderColours } from '../../skin/skin';
import { defaultSample, newObjectId, type HitObject, type Rgb, type Slider, type Vec2 } from '../../osu/types';
import {
  drawApproachCircle,
  drawFollowPoints,
  drawHitCircle,
  drawReverseArrow,
  drawSelectionRing,
  drawSkinSpinner,
  drawSliderBall,
  drawSliderBody,
  drawSliderTick,
  strokePolyline,
  toScreen,
  type View,
} from '../render/draw';
import { editor, PLAYFIELD_H, PLAYFIELD_W, snapSliderLength, translateObject } from '../store';
import { clampToPlayfield, distanceSnapActive, distanceSnapCentre, gridSnapActive, snapPosition, type Modifiers } from './snapping';

type Drag =
  | { kind: 'move'; start: Vec2; anchor: HitObject; anchorStart: Vec2; originals: Map<number, HitObject>; moved: boolean }
  | { kind: 'box'; start: Vec2; end: Vec2; additive: boolean }
  | { kind: 'point'; slider: Slider; index: number; moved: boolean };

const SPINNER_RADIUS = 180;

export class StdPlayfield {
  hover: Vec2 | null = null;
  mods: Modifiers = { shift: false, alt: false, ctrl: false };
  private drag: Drag | null = null;
  /** Slider whose control points show because the cursor is on it (or on one of its points). */
  private hoverSlider: Slider | null = null;

  // ------------------------------------------------------------------ helpers

  private fadeOutDuration() {
    return editor.prefs.showHitAnimations ? 240 : 700;
  }

  private comboColour(o: HitObject): Rgb {
    const cols = comboColours(editor.bm);
    return cols[comboColourIndex(o, editor.processed, cols.length)];
  }

  /** Alpha of an object at time t (0 = invisible). */
  private objectAlpha(o: HitObject, t: number): number {
    const p = editor.processed;
    const end = p.info.get(o.id)?.endTime ?? o.time;
    const appear = o.time - p.preempt;
    if (t < appear) return 0;
    if (t < appear + p.fadeIn) return (t - appear) / p.fadeIn;
    if (t <= end) return 1;
    const fo = this.fadeOutDuration();
    if (t < end + fo) return 1 - (t - end) / fo;
    return 0;
  }

  visibleObjects(t: number): HitObject[] {
    const p = editor.processed;
    const fo = this.fadeOutDuration();
    const out: HitObject[] = [];
    for (const o of editor.bm.hitObjects) {
      if (o.time - p.preempt > t) break;
      const end = p.info.get(o.id)?.endTime ?? o.time;
      if (end + fo < t) continue;
      out.push(o);
    }
    return out;
  }

  private selectedSlider(): Slider | null {
    if (editor.selection.size !== 1) return null;
    const o = editor.selectedObjects[0];
    return o?.kind === 'slider' ? o : null;
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: CanvasRenderingContext2D, v: View, t: number) {
    const bm = editor.bm;
    const p = editor.processed;
    const r = p.radius * v.scale;

    // Playfield border + grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(v.ox, v.oy, PLAYFIELD_W * v.scale, PLAYFIELD_H * v.scale);
    if (gridSnapActive(this.mods)) {
      const g = editor.gridSize;
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      for (let x = g; x < PLAYFIELD_W; x += g) {
        ctx.moveTo(v.ox + x * v.scale, v.oy);
        ctx.lineTo(v.ox + x * v.scale, v.oy + PLAYFIELD_H * v.scale);
      }
      for (let y = g; y < PLAYFIELD_H; y += g) {
        ctx.moveTo(v.ox, v.oy + y * v.scale);
        ctx.lineTo(v.ox + PLAYFIELD_W * v.scale, v.oy + y * v.scale);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(v.ox + 256 * v.scale, v.oy);
      ctx.lineTo(v.ox + 256 * v.scale, v.oy + PLAYFIELD_H * v.scale);
      ctx.moveTo(v.ox, v.oy + 192 * v.scale);
      ctx.lineTo(v.ox + PLAYFIELD_W * v.scale, v.oy + 192 * v.scale);
      ctx.stroke();
    }
    ctx.restore();

    const visible = this.visibleObjects(t);

    // Follow points between consecutive objects of the same combo.
    if (editor.prefs.showFollowPoints) {
      for (let i = 0; i < visible.length; i++) {
        const o = visible[i];
        const idx = bm.hitObjects.indexOf(o);
        const next = bm.hitObjects[idx + 1];
        if (!next || next.kind === 'spinner' || o.kind === 'spinner' || p.info.get(next.id)!.comboNumber === 1) continue;
        const oEnd = p.info.get(o.id)!.endTime;
        if (t > next.time || t < oEnd - p.preempt) continue;
        const a = o.kind === 'slider' ? p.info.get(o.id)!.endPos : { x: o.x, y: o.y };
        const sh = p.info.get(o.id)!.stackHeight * p.stackOffset;
        const nb = stackedPosition(next, p);
        const alpha = Math.min(1, (t - (oEnd - p.preempt)) / 300) * Math.min(1, (next.time - t) / 200 + 0.2);
        drawFollowPoints(ctx, toScreen(v, { x: a.x + sh, y: a.y + sh }), toScreen(v, nb), r, alpha * 0.7);
      }
    }

    // Draw back-to-front so earlier objects are on top.
    for (let i = visible.length - 1; i >= 0; i--) {
      const o = visible[i];
      const alpha = this.objectAlpha(o, t);
      if (alpha <= 0) continue;
      const selected = editor.selection.has(o.id);
      if (o.kind === 'spinner') this.drawSpinner(ctx, v, o, t, alpha, selected);
      else if (o.kind === 'slider') this.drawSlider(ctx, v, o, t, alpha, selected);
      else this.drawCircle(ctx, v, o, t, alpha, selected);
    }

    // Approach circles on top.
    for (const o of visible) {
      if (o.kind === 'spinner' || t > o.time) continue;
      const alpha = this.objectAlpha(o, t);
      const prog = Math.min(1, Math.max(0, (o.time - t) / p.preempt));
      const pos = toScreen(v, stackedPosition(o, p));
      drawApproachCircle(ctx, pos.x, pos.y, r * (1 + 3 * prog), this.comboColour(o), alpha * 0.9);
    }

    const sel = this.selectedSlider();
    if (sel && editor.tool === 'select') this.drawControlPoints(ctx, v, sel);
    this.updateHoverSlider(v, t);
    if (this.hoverSlider && this.hoverSlider !== sel) this.drawControlPoints(ctx, v, this.hoverSlider, 0.6);

    this.drawPlacement(ctx, v, t, r);

    if (this.drag?.kind === 'box') {
      const a = toScreen(v, this.drag.start);
      const b = toScreen(v, this.drag.end);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      ctx.restore();
    }
  }

  private hitAnimation(o: HitObject, t: number, endTime: number) {
    // Returns a scale factor for the "explode" after hit when hit animations are on.
    if (!editor.prefs.showHitAnimations || t <= endTime) return 1;
    return 1 + Math.min(1, (t - endTime) / 240) * 0.4;
  }

  private drawCircle(ctx: CanvasRenderingContext2D, v: View, o: HitObject, t: number, alpha: number, selected: boolean) {
    const p = editor.processed;
    const pos = toScreen(v, stackedPosition(o, p));
    const s = this.hitAnimation(o, t, o.time);
    const info = p.info.get(o.id);
    drawHitCircle(ctx, pos.x, pos.y, p.radius * v.scale * s, this.comboColour(o), alpha, String(info?.comboNumber ?? ''), selected);
  }

  private drawSlider(ctx: CanvasRenderingContext2D, v: View, o: Slider, t: number, alpha: number, selected: boolean) {
    const bm = editor.bm;
    const p = editor.processed;
    const info = p.info.get(o.id)!;
    const path = getSliderPath(o);
    const sh = info.stackHeight * p.stackOffset;
    const toS = (q: Vec2) => toScreen(v, { x: q.x + sh, y: q.y + sh });
    const r = p.radius * v.scale;
    const colour = this.comboColour(o);
    const { track, border } = sliderColours(bm, colour);
    let pts = path.points;
    if (editor.prefs.snakingSliders && t < o.time) {
      const appear = o.time - p.preempt;
      const snake = Math.min(1, Math.max(0, (t - appear) / (p.preempt / 3)));
      pts = path.pathBetween(0, snake);
    }
    const bodyAlpha = t > info.endTime ? alpha : alpha;
    drawSliderBody(ctx, pts.map(toS), r, track, border, bodyAlpha * 0.9, selected);

    // Ticks
    const span = sliderSpanDuration(bm, o);
    for (const tp of sliderTickProgresses(bm, o)) {
      const q = toS(path.positionAt(tp));
      drawSliderTick(ctx, q.x, q.y, r, alpha);
    }

    // Reverse arrows
    if (o.slides > 1) {
      const elapsedSpans = t < o.time ? 0 : Math.floor((t - o.time) / Math.max(1, span));
      const end = toS(path.positionAt(1));
      const nearEnd = toS(path.positionAt(Math.max(0, 1 - 5 / Math.max(1, path.length))));
      const start = toS(path.positionAt(0));
      const nearStart = toS(path.positionAt(Math.min(1, 5 / Math.max(1, path.length))));
      // Arrow at the end is visible while a repeat towards the head is still to come.
      if (elapsedSpans < o.slides - 1) drawReverseArrow(ctx, end, nearEnd, r, alpha);
      if (o.slides > 2 && elapsedSpans < o.slides - 2 && elapsedSpans >= 0) drawReverseArrow(ctx, start, nearStart, r, alpha);
    }

    // Head circle (hidden once the slider has started when hit animations are on)
    const head = toS({ x: o.x, y: o.y });
    if (!(editor.prefs.showHitAnimations && t > o.time + 240)) {
      const s = this.hitAnimation(o, t, o.time);
      const headAlpha = editor.prefs.showHitAnimations && t > o.time ? alpha * (1 - (t - o.time) / 240) : alpha;
      drawHitCircle(ctx, head.x, head.y, r * s, colour, headAlpha, String(info.comboNumber), false);
    }
    if (selected) {
      drawSelectionRing(ctx, head.x, head.y, r);
      const e = toS(path.positionAt(1));
      drawSelectionRing(ctx, e.x, e.y, r * 0.9);
    }

    // Slider ball while active
    if (t >= o.time && t <= info.endTime && span > 0) {
      const at = (t - o.time) / span;
      const ball = toS(sliderPositionAtSpan(o, at));
      const ahead = toS(sliderPositionAtSpan(o, at + 0.01));
      drawSliderBall(ctx, ball, Math.atan2(ahead.y - ball.y, ahead.x - ball.x), r, colour, alpha);
    }
  }

  private drawSpinner(ctx: CanvasRenderingContext2D, v: View, o: HitObject & { kind: 'spinner' }, t: number, alpha: number, selected: boolean) {
    const c = toScreen(v, { x: 256, y: 192 });
    const R = SPINNER_RADIUS * v.scale;
    const prog = t < o.time ? 1 : Math.max(0, 1 - (t - o.time) / Math.max(1, o.endTime - o.time));
    if (drawSkinSpinner(ctx, c, v.scale, prog, alpha, SPINNER_RADIUS)) {
      if (selected) {
        ctx.save();
        ctx.strokeStyle = '#ffd400';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(20,20,30,0.55)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = selected ? '#ffd400' : '#fff';
    ctx.lineWidth = selected ? 4 : 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, R * prog), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Like stable, hovering a slider with the select tool shows its control points; they stay while the cursor is on one. */
  private updateHoverSlider(v: View, t: number) {
    const p = this.hover;
    if (!p || editor.tool !== 'select' || this.drag) {
      this.hoverSlider = this.drag?.kind === 'point' ? this.hoverSlider : null;
      return;
    }
    const hit = this.hitTest(p, t);
    if (hit?.kind === 'slider') this.hoverSlider = hit;
    else if (!this.hoverSlider || !editor.bm.hitObjects.includes(this.hoverSlider) || this.hitControlPoint(p, v, this.hoverSlider) < 0) this.hoverSlider = null;
  }

  private drawControlPoints(ctx: CanvasRenderingContext2D, v: View, s: Slider, alpha = 1) {
    const verts = [{ x: s.x, y: s.y }, ...s.points];
    const sp = verts.map((q) => toScreen(v, q));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    strokePolyline(ctx, sp);
    for (let i = 0; i < verts.length; i++) {
      const red = (i > 0 && verts[i - 1].x === verts[i].x && verts[i - 1].y === verts[i].y) ||
        (i < verts.length - 1 && verts[i + 1].x === verts[i].x && verts[i + 1].y === verts[i].y);
      const size = 7;
      ctx.fillStyle = red ? '#ff3b3b' : i === 0 ? '#ffd400' : '#fff';
      ctx.strokeStyle = '#000';
      ctx.fillRect(sp[i].x - size / 2, sp[i].y - size / 2, size, size);
      ctx.strokeRect(sp[i].x - size / 2, sp[i].y - size / 2, size, size);
    }
    ctx.restore();
  }

  private drawPlacement(ctx: CanvasRenderingContext2D, v: View, t: number, r: number) {
    const tool = editor.tool;
    if (tool === 'select' || !this.hover) return;
    const time = editor.snap(t);
    const placing = editor.placing?.kind === 'slider' ? editor.placing : null;
    const firstPoint = !placing;
    const pos = firstPoint ? snapPosition(this.hover, this.mods, time) : this.snapNonHead(this.hover);

    if (firstPoint && distanceSnapActive(this.mods) && (tool === 'circle' || tool === 'slider')) {
      const ds = distanceSnapCentre(time);
      if (ds) {
        const c = toScreen(v, ds.centre);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, ds.radius * v.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (tool === 'circle') {
      const s = toScreen(v, pos);
      drawHitCircle(ctx, s.x, s.y, r, { r: 200, g: 200, b: 200 }, 0.5, null, false);
    } else if (tool === 'slider') {
      if (placing) {
        // Preview the body clipped to the beat-snapped length it will get, like stable.
        const verts = [...placing.vertices, pos];
        const preview = { x: verts[0].x, y: verts[0].y, curveType: autoCurveType(verts), points: verts.slice(1), length: 0, time: placing.time } as Slider;
        preview.length = getSliderPath(preview).rawLength;
        snapSliderLength(editor.bm, preview, editor.beatDivisor);
        const body = preview.length >= 1 ? getSliderPath(preview).points : computeRawPath(preview.curveType, verts);
        drawSliderBody(ctx, body.map((q) => toScreen(v, q)), r, { r: 180, g: 180, b: 180 }, { r: 255, g: 255, b: 255 }, 0.6, false);
        if (preview.length >= 1) {
          const end = toScreen(v, getSliderPath(preview).positionAt(1));
          drawHitCircle(ctx, end.x, end.y, r, { r: 200, g: 200, b: 200 }, 0.45, null, false);
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        strokePolyline(ctx, verts.map((q) => toScreen(v, q)));
        ctx.restore();
        const h = toScreen(v, placing.vertices[0]);
        drawHitCircle(ctx, h.x, h.y, r, { r: 200, g: 200, b: 200 }, 0.7, null, false);
      } else {
        const s = toScreen(v, pos);
        drawHitCircle(ctx, s.x, s.y, r, { r: 200, g: 200, b: 200 }, 0.5, null, false);
      }
    } else if (tool === 'spinner') {
      const c = toScreen(v, { x: 256, y: 192 });
      const pending = editor.placing?.kind === 'spinner' ? editor.placing : null;
      ctx.save();
      ctx.globalAlpha = pending ? 0.7 : 0.35;
      if (pending) {
        ctx.fillStyle = '#fff';
        ctx.font = '13px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        const len = Math.round(time - pending.time);
        ctx.fillText(len > 0 ? `Spinner: ${len} ms. Click to end it here.` : 'Seek forward and click to end the spinner.', c.x, c.y + 4);
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, SPINNER_RADIUS * v.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private snapNonHead(p: Vec2): Vec2 {
    if (gridSnapActive(this.mods)) {
      const g = editor.gridSize;
      return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    }
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  // ------------------------------------------------------------------ hit testing

  hitTest(p: Vec2, t: number): HitObject | null {
    const proc = editor.processed;
    const r = proc.radius;
    let best: HitObject | null = null;
    let bestDt = Infinity;
    for (const o of this.visibleObjects(t)) {
      if (this.objectAlpha(o, t) <= 0.05) continue;
      let hit = false;
      if (o.kind === 'spinner') hit = dist(p, { x: 256, y: 192 }) < SPINNER_RADIUS && dist(p, { x: 256, y: 192 }) > SPINNER_RADIUS - 20;
      else {
        const pos = stackedPosition(o, proc);
        hit = dist(p, pos) <= r;
        if (!hit && o.kind === 'slider') {
          const sh = proc.info.get(o.id)!.stackHeight * proc.stackOffset;
          const pts = getSliderPath(o).points;
          for (let i = 1; i < pts.length && !hit; i++) {
            if (distToSegment(p, { x: pts[i - 1].x + sh, y: pts[i - 1].y + sh }, { x: pts[i].x + sh, y: pts[i].y + sh }) <= r * 0.9) hit = true;
          }
        }
      }
      if (hit) {
        const dt = Math.abs(o.time - t);
        if (dt < bestDt) {
          bestDt = dt;
          best = o;
        }
      }
    }
    return best;
  }

  private hitControlPoint(p: Vec2, v: View, s: Slider): number {
    const verts = [{ x: s.x, y: s.y }, ...s.points];
    const tol = 8 / v.scale;
    for (let i = verts.length - 1; i >= 0; i--) if (Math.abs(verts[i].x - p.x) <= tol && Math.abs(verts[i].y - p.y) <= tol) return i;
    return -1;
  }

  // ------------------------------------------------------------------ interaction

  pointerDown(p: Vec2, button: number, v: View) {
    const t = music.time;
    if (button === 2) {
      this.rightClick(p, v, t);
      return;
    }
    if (button !== 0) return;

    switch (editor.tool) {
      case 'circle':
        this.placeCircle(p);
        return;
      case 'spinner':
        editor.spinnerClick();
        return;
      case 'slider':
        this.sliderClick(p);
        return;
    }

    // Select tool
    const sel = this.selectedSlider();
    if (sel) {
      const idx = this.hitControlPoint(p, v, sel);
      if (idx >= 0) {
        if (this.mods.ctrl) {
          this.toggleRedAnchor(sel, idx);
          return;
        }
        if (!editor.locked) {
          editor.beginChange();
          this.drag = { kind: 'point', slider: sel, index: idx, moved: false };
        }
        return;
      }
      if (this.mods.ctrl && this.insertControlPoint(sel, p)) return;
    }
    // A point of the hovered slider can be dragged straight away.
    const hov = this.hoverSlider;
    if (hov && hov !== sel && !this.mods.ctrl && !this.mods.shift) {
      const idx = this.hitControlPoint(p, v, hov);
      if (idx >= 0) {
        editor.select([hov.id]);
        if (!editor.locked) {
          editor.beginChange();
          this.drag = { kind: 'point', slider: hov, index: idx, moved: false };
        }
        return;
      }
    }

    const hit = this.hitTest(p, t);
    if (hit) {
      if (this.mods.ctrl || this.mods.shift) {
        editor.toggleSelect(hit.id);
        return;
      }
      if (!editor.selection.has(hit.id)) editor.select([hit.id]);
      if (editor.locked) return;
      const originals = new Map<number, HitObject>();
      for (const o of editor.selectedObjects) originals.set(o.id, structuredClone(o));
      editor.beginChange();
      this.drag = { kind: 'move', start: p, anchor: hit, anchorStart: { x: hit.x, y: hit.y }, originals, moved: false };
    } else {
      this.drag = { kind: 'box', start: p, end: p, additive: this.mods.ctrl || this.mods.shift };
      if (!this.drag.additive) editor.clearSelection();
    }
  }

  pointerMove(p: Vec2) {
    this.hover = p;
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'box') {
      d.end = p;
      const minX = Math.min(d.start.x, p.x), maxX = Math.max(d.start.x, p.x);
      const minY = Math.min(d.start.y, p.y), maxY = Math.max(d.start.y, p.y);
      const t = music.time;
      const ids = this.visibleObjects(t)
        .filter((o) => this.objectAlpha(o, t) > 0.05)
        .filter((o) => {
          const q = o.kind === 'spinner' ? { x: 256, y: 192 } : stackedPosition(o, editor.processed);
          return q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY;
        })
        .map((o) => o.id);
      editor.select(ids, d.additive);
    } else if (d.kind === 'move') {
      const target = { x: d.anchorStart.x + (p.x - d.start.x), y: d.anchorStart.y + (p.y - d.start.y) };
      const exclude = new Set(d.originals.keys());
      const snapped = snapPosition(target, this.mods, d.anchor.time, exclude);
      const dx = snapped.x - d.anchorStart.x;
      const dy = snapped.y - d.anchorStart.y;
      if (dx !== 0 || dy !== 0) d.moved = true;
      for (const o of editor.bm.hitObjects) {
        const orig = d.originals.get(o.id);
        if (!orig || o.kind === 'spinner') continue;
        o.x = orig.x;
        o.y = orig.y;
        if (o.kind === 'slider' && orig.kind === 'slider') o.points = orig.points.map((q) => ({ ...q }));
        translateObject(o, dx, dy);
      }
      editor.touch();
    } else if (d.kind === 'point') {
      const s = d.slider;
      const q = clampToPlayfield(this.snapNonHead(p));
      const verts = [{ x: s.x, y: s.y }, ...s.points];
      const old = verts[d.index];
      // Moving a red anchor moves both of its duplicate points.
      const twin = d.index + 1 < verts.length && verts[d.index + 1].x === old.x && verts[d.index + 1].y === old.y ? d.index + 1 : -1;
      verts[d.index] = q;
      if (twin >= 0) verts[twin] = { ...q };
      s.x = verts[0].x;
      s.y = verts[0].y;
      s.points = verts.slice(1);
      s.length = getSliderPath({ ...s, length: 0 }).rawLength;
      snapSliderLength(editor.bm, s, editor.beatDivisor);
      d.moved = true;
      editor.touch();
    }
  }

  pointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'move' || d.kind === 'point') {
      if (d.moved) editor.endChange();
      else editor.cancelChange();
    }
  }

  doubleClick(p: Vec2) {
    if (editor.tool !== 'select') return;
    const t = music.time;
    const hit = this.hitTest(p, t);
    // Like stable, double-clicking a slider end jumps to the end of the slider.
    for (const o of this.visibleObjects(t)) {
      if (o.kind !== 'slider' || this.objectAlpha(o, t) <= 0.05) continue;
      const info = editor.processed.info.get(o.id);
      if (info && dist(p, info.endPos) <= editor.processed.radius && (!hit || hit === o)) {
        music.seek(info.endTime);
        return;
      }
    }
    if (hit) music.seek(hit.time);
  }

  private rightClick(p: Vec2, v: View, t: number) {
    if (editor.placing?.kind === 'slider') {
      this.finishSlider();
      return;
    }
    if (editor.placing?.kind === 'spinner') {
      editor.spinnerClick();
      return;
    }
    if (editor.tool !== 'select') {
      editor.toggleNewCombo();
      return;
    }
    const sel = this.selectedSlider();
    if (sel) {
      const idx = this.hitControlPoint(p, v, sel);
      if (idx > 0) {
        this.deleteControlPoint(sel, idx);
        return;
      }
    }
    const hit = this.hitTest(p, t);
    if (hit) editor.deleteObject(hit.id);
  }

  cancel() {
    if (editor.placing) {
      editor.placing = null;
      editor.emit();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ placement

  private placementTime() {
    return Math.round(editor.snap(music.time));
  }

  private placementSound() {
    const pl = editor.placement;
    return (pl.whistle ? 2 : 0) | (pl.finish ? 4 : 0) | (pl.clap ? 8 : 0);
  }

  private placementSample() {
    const s = defaultSample();
    s.normalSet = editor.placement.normalSet;
    s.additionSet = editor.placement.additionSet;
    return s;
  }

  private placeCircle(p: Vec2) {
    const time = this.placementTime();
    const pos = clampToPlayfield(snapPosition(p, this.mods, time));
    editor.addObject({
      id: newObjectId(),
      kind: 'circle',
      x: pos.x,
      y: pos.y,
      time,
      newCombo: editor.placement.newCombo,
      comboSkip: 0,
      hitSound: this.placementSound(),
      sample: this.placementSample(),
    });
  }

  private sliderClick(p: Vec2) {
    const time = this.placementTime();
    const placing = editor.placing?.kind === 'slider' ? editor.placing : null;
    if (!placing) {
      const pos = clampToPlayfield(snapPosition(p, this.mods, time));
      editor.placing = { kind: 'slider', vertices: [pos], time };
      editor.emit();
      return;
    }
    const pos = clampToPlayfield(this.snapNonHead(p));
    const last = placing.vertices[placing.vertices.length - 1];
    if (placing.vertices.length > 1 && dist(last, pos) < 4) {
      // Clicking the last point again makes it a red anchor (or finishes if it already is one).
      const prev = placing.vertices[placing.vertices.length - 2];
      if (prev.x === last.x && prev.y === last.y) {
        placing.vertices.pop();
        this.finishSlider();
        return;
      }
      placing.vertices.push({ ...last });
    } else if (dist(last, pos) >= 1) {
      placing.vertices.push(pos);
    }
    editor.emit();
  }

  finishSlider() {
    const placing = editor.placing?.kind === 'slider' ? editor.placing : null;
    if (!placing) return;
    editor.placing = null;
    // The preview runs to the cursor, so finishing keeps that point (what you see is what you get).
    if (this.hover) {
      const pos = clampToPlayfield(this.snapNonHead(this.hover));
      if (dist(placing.vertices[placing.vertices.length - 1], pos) >= 4) placing.vertices.push(pos);
    }
    if (placing.vertices.length < 2) {
      editor.emit();
      return;
    }
    const verts = placing.vertices;
    const sound = this.placementSound();
    const s: Slider = {
      id: newObjectId(),
      kind: 'slider',
      x: verts[0].x,
      y: verts[0].y,
      time: placing.time,
      newCombo: editor.placement.newCombo,
      comboSkip: 0,
      hitSound: sound,
      sample: this.placementSample(),
      curveType: autoCurveType(verts),
      points: verts.slice(1),
      slides: 1,
      length: 0,
      edgeSounds: [sound, sound],
      edgeSets: [
        { normal: 0, addition: 0 },
        { normal: 0, addition: 0 },
      ],
    };
    s.length = getSliderPath({ ...s, length: 0 }).rawLength;
    if (s.length < 1) {
      editor.emit();
      return;
    }
    snapSliderLength(editor.bm, s, editor.beatDivisor);
    editor.addObject(s);
  }

  // ------------------------------------------------------------------ control point editing

  private toggleRedAnchor(s: Slider, idx: number) {
    if (idx === 0) return;
    editor.commit(() => {
      const verts = [{ x: s.x, y: s.y }, ...s.points];
      const v = verts[idx];
      const nextSame = idx + 1 < verts.length && verts[idx + 1].x === v.x && verts[idx + 1].y === v.y;
      const prevSame = verts[idx - 1].x === v.x && verts[idx - 1].y === v.y;
      if (nextSame) verts.splice(idx + 1, 1);
      else if (prevSame) verts.splice(idx, 1);
      else if (idx < verts.length - 1) verts.splice(idx, 0, { ...v });
      s.points = verts.slice(1);
      if (s.curveType !== 'B' && s.curveType !== 'L') s.curveType = 'B';
      s.length = getSliderPath({ ...s, length: 0 }).rawLength;
      snapSliderLength(editor.bm, s, editor.beatDivisor);
    });
  }

  private insertControlPoint(s: Slider, p: Vec2): boolean {
    const verts = [{ x: s.x, y: s.y }, ...s.points];
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 1; i < verts.length; i++) {
      const d = distToSegment(p, verts[i - 1], verts[i]);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    // Also accept clicks on the rendered body.
    const onBody = getSliderPath(s).points.some((q) => dist(q, p) < editor.processed.radius);
    if (bestI < 0 || (bestD > 12 && !onBody)) return false;
    editor.commit(() => {
      verts.splice(bestI, 0, { x: Math.round(p.x), y: Math.round(p.y) });
      s.points = verts.slice(1);
      if (s.curveType === 'P' || s.curveType === 'L') s.curveType = 'B';
      s.length = getSliderPath({ ...s, length: 0 }).rawLength;
      snapSliderLength(editor.bm, s, editor.beatDivisor);
    });
    return true;
  }

  private deleteControlPoint(s: Slider, idx: number) {
    if (s.points.length <= 1) return;
    editor.commit(() => {
      s.points.splice(idx - 1, 1);
      if (s.curveType === 'P' && s.points.length !== 2) s.curveType = 'B';
      s.length = getSliderPath({ ...s, length: 0 }).rawLength;
      snapSliderLength(editor.bm, s, editor.beatDivisor);
    });
  }
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
