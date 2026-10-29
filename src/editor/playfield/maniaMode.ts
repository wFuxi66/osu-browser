// osu!mania compose surface: vertical scrolling columns, notes and holds placed by clicking columns.
import { music } from '../../audio/music';
import { redLineAt } from '../../osu/timing';
import { defaultSample, newObjectId, type HitObject } from '../../osu/types';
import { editor, maniaColumn, maniaX } from '../store';
import { drawBeatLines } from './scrolling';
import type { Modifiers } from './snapping';
import type { PlayfieldMode } from './types';

type Drag =
  | { kind: 'place'; column: number; start: number; end: number }
  | { kind: 'move'; startTime: number; startCol: number; originals: Map<number, { time: number; endTime?: number; col: number }>; moved: boolean }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean };

export class ManiaMode implements PlayfieldMode {
  mods: Modifiers = { shift: false, alt: false, ctrl: false };
  private h = 0;
  private colW = 50;
  private left = 0;
  private judgeY = 0;
  private hover: { x: number; y: number } | null = null;
  private drag: Drag | null = null;
  /** Pixels per millisecond of scroll; adjusted with the timeline zoom. */
  get pxPerMs() {
    return 0.45 * (this.h / 700) * editor.shownZoom;
  }

  private get keys() {
    return Math.max(1, Math.round(editor.bm.difficulty.circleSize));
  }

  layout(w: number, h: number) {
    this.h = h;
    this.colW = Math.min(64, Math.max(24, (w * 0.6) / this.keys));
    this.left = (w - this.colW * this.keys) / 2;
    this.judgeY = h - 70;
  }

  private timeAtY(y: number, t: number) {
    return t + (this.judgeY - y) / this.pxPerMs;
  }

  private yAtTime(time: number, t: number) {
    return this.judgeY - (time - t) * this.pxPerMs;
  }

  private columnAt(x: number): number {
    const c = Math.floor((x - this.left) / this.colW);
    return c >= 0 && c < this.keys ? c : -1;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const bm = editor.bm;
    const keys = this.keys;
    const top = 0;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(this.left, top, this.colW * keys, this.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    for (let c = 0; c <= keys; c++) {
      ctx.beginPath();
      ctx.moveTo(this.left + c * this.colW, top);
      ctx.lineTo(this.left + c * this.colW, this.h);
      ctx.stroke();
    }

    // Beat snap lines
    const tStart = this.timeAtY(this.h, t);
    const tEnd = this.timeAtY(0, t);
    drawBeatLines(ctx, bm, editor.beatDivisor, tStart, tEnd, (time) => this.yAtTime(time, t), this.left, this.left + this.colW * keys);

    // Judgement line
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.left, this.judgeY);
    ctx.lineTo(this.left + this.colW * keys, this.judgeY);
    ctx.stroke();

    // Notes
    const noteH = Math.max(8, this.colW * 0.3);
    for (const o of bm.hitObjects) {
      const end = o.kind === 'hold' ? o.endTime : o.time;
      if (end < tStart - 100) continue;
      if (o.time > tEnd + 100) break;
      const col = maniaColumn(o.x, keys);
      const x = this.left + col * this.colW + 2;
      const y = this.yAtTime(o.time, t);
      const colour = this.columnColour(col, keys);
      const sel = editor.selection.has(o.id);
      if (o.kind === 'hold') {
        const y2 = this.yAtTime(o.endTime, t);
        ctx.fillStyle = colour;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x + this.colW * 0.15, y2, this.colW - 4 - this.colW * 0.3, y - y2);
        ctx.globalAlpha = 1;
        ctx.fillRect(x, y2 - noteH / 2, this.colW - 4, noteH / 2);
      }
      ctx.fillStyle = colour;
      ctx.fillRect(x, y - noteH, this.colW - 4, noteH);
      if (sel) {
        ctx.strokeStyle = '#ffd400';
        ctx.lineWidth = 3;
        const y2 = o.kind === 'hold' ? this.yAtTime(o.endTime, t) - noteH / 2 : y - noteH;
        ctx.strokeRect(x - 1, y2, this.colW - 2, y - y2 + 1);
      }
    }

    // Placement preview
    if (this.drag?.kind === 'place') {
      const d = this.drag;
      const x = this.left + d.column * this.colW + 2;
      const y = this.yAtTime(d.start, t);
      const y2 = this.yAtTime(Math.max(d.start, d.end), t);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x, y2 - noteH, this.colW - 4, y - y2 + noteH);
      ctx.globalAlpha = 1;
    } else if (this.hover && editor.tool !== 'select') {
      const col = this.columnAt(this.hover.x);
      if (col >= 0) {
        const time = editor.snap(this.timeAtY(this.hover.y, t));
        const y = this.yAtTime(time, t);
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#fff';
        ctx.fillRect(this.left + col * this.colW + 2, y - noteH, this.colW - 4, noteH);
        ctx.globalAlpha = 1;
      }
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

  private columnColour(col: number, keys: number): string {
    const centre = keys % 2 === 1 && col === (keys - 1) / 2;
    if (centre) return '#ffcc22';
    const odd = (keys % 2 === 1 ? (col < keys / 2 ? col : keys - 1 - col) : col < keys / 2 ? col : keys - 1 - col) % 2 === 0;
    return odd ? '#e8e8f0' : '#58b8ff';
  }

  private hitTest(x: number, y: number, t: number): HitObject | null {
    const col = this.columnAt(x);
    if (col < 0) return null;
    const noteH = Math.max(8, this.colW * 0.3);
    for (const o of editor.bm.hitObjects) {
      if (maniaColumn(o.x, this.keys) !== col) continue;
      const y1 = this.yAtTime(o.time, t);
      const y0 = o.kind === 'hold' ? this.yAtTime(o.endTime, t) - noteH / 2 : y1 - noteH;
      if (y >= y0 - 3 && y <= y1 + 3) return o;
    }
    return null;
  }

  pointerDown(x: number, y: number, button: number) {
    const t = music.time;
    const hit = this.hitTest(x, y, t);
    if (button === 2) {
      if (hit) editor.deleteObject(hit.id);
      return;
    }
    if (button !== 0) return;
    if (editor.tool === 'select' || hit) {
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
      if (editor.tool !== 'select') editor.tool = 'select';
      const originals = new Map<number, { time: number; endTime?: number; col: number }>();
      for (const o of editor.selectedObjects) originals.set(o.id, { time: o.time, endTime: o.kind === 'hold' ? o.endTime : undefined, col: maniaColumn(o.x, this.keys) });
      editor.beginChange();
      this.drag = { kind: 'move', startTime: editor.snap(this.timeAtY(y, t)), startCol: this.columnAt(x), originals, moved: false };
      return;
    }
    const col = this.columnAt(x);
    if (col < 0) return;
    const time = Math.round(editor.snap(this.timeAtY(y, t)));
    this.drag = { kind: 'place', column: col, start: time, end: time };
  }

  pointerMove(x: number, y: number) {
    this.hover = { x, y };
    const d = this.drag;
    if (!d) return;
    const t = music.time;
    if (d.kind === 'place') {
      if (editor.tool === 'slider') d.end = Math.round(editor.snap(this.timeAtY(y, t)));
    } else if (d.kind === 'box') {
      d.x1 = x;
      d.y1 = y;
      const c0 = Math.floor((Math.min(d.x0, d.x1) - this.left) / this.colW);
      const c1 = Math.floor((Math.max(d.x0, d.x1) - this.left) / this.colW);
      const tA = this.timeAtY(Math.max(d.y0, d.y1), t);
      const tB = this.timeAtY(Math.min(d.y0, d.y1), t);
      const ids = editor.bm.hitObjects
        .filter((o) => {
          const c = maniaColumn(o.x, this.keys);
          return c >= c0 && c <= c1 && o.time >= tA && o.time <= tB;
        })
        .map((o) => o.id);
      editor.select(ids, d.additive);
    } else if (d.kind === 'move') {
      const time = editor.snap(this.timeAtY(y, t));
      const dt = Math.round(time - d.startTime);
      const col = this.columnAt(x);
      const dc = col >= 0 && d.startCol >= 0 ? col - d.startCol : 0;
      const cols = [...d.originals.values()].map((o) => o.col + dc);
      const okCols = cols.every((c) => c >= 0 && c < this.keys);
      for (const o of editor.bm.hitObjects) {
        const orig = d.originals.get(o.id);
        if (!orig) continue;
        o.time = orig.time + dt;
        if (o.kind === 'hold' && orig.endTime !== undefined) o.endTime = orig.endTime + dt;
        if (okCols) o.x = maniaX(orig.col + dc, this.keys);
      }
      if (dt !== 0 || dc !== 0) d.moved = true;
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
    } else if (d.kind === 'place') {
      const pl = editor.placement;
      const sample = defaultSample();
      sample.normalSet = pl.normalSet;
      sample.additionSet = pl.additionSet;
      const base = {
        id: newObjectId(),
        x: maniaX(d.column, this.keys),
        y: 192,
        time: d.start,
        newCombo: false,
        comboSkip: 0,
        hitSound: (pl.whistle ? 2 : 0) | (pl.finish ? 4 : 0) | (pl.clap ? 8 : 0),
        sample,
      };
      if (editor.tool === 'slider') {
        // A click without dragging makes a one-beat hold.
        const end = d.end > d.start ? d.end : Math.round(d.start + redLineAt(editor.bm, d.start).beatLength);
        const o = { ...base, kind: 'hold' as const, endTime: end };
        editor.addObject(o);
        editor.advanceAfterPlace(o);
      } else {
        const o = { ...base, kind: 'circle' as const };
        editor.addObject(o);
        editor.advanceAfterPlace(o);
      }
    }
  }

  pointerLeave() {
    this.hover = null;
  }

  doubleClick(x: number, y: number) {
    const hit = this.hitTest(x, y, music.time);
    if (hit) music.seek(hit.time);
  }

  cancel() {
    if (this.drag?.kind === 'place') {
      this.drag = null;
      return true;
    }
    return false;
  }
}
