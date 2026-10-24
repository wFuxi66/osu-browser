// osu!taiko compose surface: a horizontal drum lane; notes are placed at the current (snapped) time.
import { music } from '../../audio/music';
import { getSliderPath } from '../../osu/curves';
import { objectEndTime, redLineAt, svAt } from '../../osu/timing';
import { defaultSample, newObjectId, type HitObject } from '../../osu/types';
import { editor, snapSliderLength } from '../store';
import type { Modifiers } from './snapping';
import type { PlayfieldMode } from './types';

const isKat = (o: HitObject) => (o.hitSound & (2 | 8)) !== 0;
const isBig = (o: HitObject) => (o.hitSound & 4) !== 0;

export class TaikoMode implements PlayfieldMode {
  mods: Modifiers = { shift: false, alt: false, ctrl: false };
  private w = 0;
  private laneY = 0;
  private laneH = 120;
  private hitX = 0;
  private box: { x0: number; x1: number; additive: boolean } | null = null;

  layout(w: number, h: number) {
    this.w = w;
    this.laneH = Math.min(140, h * 0.3);
    this.laneY = h / 2 - this.laneH / 2;
    this.hitX = Math.max(90, w * 0.15);
  }

  private speed(time: number) {
    const bm = editor.bm;
    // Taiko scroll speed follows BPM and SV: (slider px per beat) / (ms per beat), scaled to the lane.
    const pxPerBeat = bm.difficulty.sliderMultiplier * 100 * svAt(bm, time);
    return (pxPerBeat / Math.max(1, redLineAt(bm, time).beatLength)) * (this.laneH / 120) * 0.9;
  }

  private xAt(time: number, t: number) {
    return this.hitX + (time - t) * this.speed(time);
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    const bm = editor.bm;
    const r = this.laneH * 0.28;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, this.laneY, this.w, this.laneH);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(-1, this.laneY, this.w + 2, this.laneH);
    const cy = this.laneY + this.laneH / 2;

    // Bar lines
    const red = redLineAt(bm, t);
    if (red.beatLength > 0) {
      const bar = red.beatLength * red.meter;
      let k = Math.floor((t - 2000 - red.time) / bar);
      for (; ; k++) {
        const time = red.time + k * bar;
        const x = this.xAt(time, t);
        if (x > this.w) break;
        if (x < 0) continue;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(x, this.laneY);
        ctx.lineTo(x, this.laneY + this.laneH);
        ctx.stroke();
      }
    }

    // Hit target
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.hitX, cy, r * 1.05, 0, Math.PI * 2);
    ctx.stroke();

    const objs = bm.hitObjects;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      const end = objectEndTime(bm, o);
      const x0 = this.xAt(o.time, t);
      const x1 = this.xAt(end, t);
      if (x1 < -r * 2 || x0 > this.w + r * 2) continue;
      const big = isBig(o) ? 1.45 : 1;
      const sel = editor.selection.has(o.id);
      if (o.kind === 'slider') {
        ctx.fillStyle = '#fcb806';
        ctx.beginPath();
        ctx.arc(x1, cy, r * 0.85 * big, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x0, cy + r * 0.85 * big);
        ctx.arc(x0, cy, r * 0.85 * big, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        ctx.fill();
      } else if (o.kind === 'spinner') {
        ctx.fillStyle = '#7a7a7a';
        ctx.fillRect(x0, cy - 4, Math.max(0, x1 - x0), 8);
        ctx.fillStyle = '#ddd';
        ctx.beginPath();
        ctx.arc(x0, cy, r * 1.1, 0, Math.PI * 2);
        ctx.fill();
        continue;
      } else {
        ctx.fillStyle = isKat(o) ? '#448aca' : '#eb452c';
        ctx.beginPath();
        ctx.arc(x0, cy, r * big, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = r * 0.12;
        ctx.stroke();
      }
      if (sel) {
        ctx.strokeStyle = '#ffd400';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x0, cy, r * big * 1.15, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (this.box) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(Math.min(this.box.x0, this.box.x1), this.laneY, Math.abs(this.box.x1 - this.box.x0), this.laneH);
    }
    ctx.restore();
  }

  private hitTest(x: number, y: number, t: number): HitObject | null {
    if (y < this.laneY || y > this.laneY + this.laneH) return null;
    const r = this.laneH * 0.28;
    let best: HitObject | null = null;
    let bestD = Infinity;
    for (const o of editor.bm.hitObjects) {
      const x0 = this.xAt(o.time, t);
      const x1 = this.xAt(objectEndTime(editor.bm, o), t);
      const d = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      if (d <= r && d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  pointerDown(x: number, y: number, button: number) {
    const t = music.time;
    const hit = this.hitTest(x, y, t);
    if (button === 2) {
      if (editor.placing?.kind === 'spinner') editor.spinnerClick();
      else if (hit) editor.deleteObject(hit.id);
      else editor.toggleNewCombo();
      return;
    }
    if (button !== 0) return;
    if (editor.tool === 'select') {
      if (hit) {
        if (this.mods.ctrl || this.mods.shift) editor.toggleSelect(hit.id);
        else editor.select([hit.id]);
      } else {
        this.box = { x0: x, x1: x, additive: this.mods.ctrl || this.mods.shift };
        if (!this.box.additive) editor.clearSelection();
      }
      return;
    }
    this.place();
  }

  private place() {
    const time = Math.round(editor.snap(music.time));
    const pl = editor.placement;
    const sample = defaultSample();
    sample.normalSet = pl.normalSet;
    sample.additionSet = pl.additionSet;
    const hitSound = (pl.whistle ? 2 : 0) | (pl.finish ? 4 : 0) | (pl.clap ? 8 : 0);
    const base = { id: newObjectId(), x: 256, y: 192, time, newCombo: pl.newCombo, comboSkip: 0, hitSound, sample };
    const bm = editor.bm;
    if (editor.tool === 'circle') editor.addObject({ ...base, kind: 'circle' });
    else if (editor.tool === 'spinner') editor.spinnerClick();
    else if (editor.tool === 'slider') {
      const len = bm.difficulty.sliderMultiplier * 100 * svAt(bm, time);
      const s = {
        ...base,
        kind: 'slider' as const,
        curveType: 'L' as const,
        points: [{ x: 256 + Math.round(len), y: 192 }],
        slides: 1,
        length: len,
        edgeSounds: [hitSound, hitSound],
        edgeSets: [{ normal: 0 as const, addition: 0 as const }, { normal: 0 as const, addition: 0 as const }],
      };
      s.length = getSliderPath({ ...s, length: 0 }).rawLength;
      snapSliderLength(bm, s, editor.beatDivisor);
      editor.addObject(s);
    }
  }

  pointerMove(x: number) {
    if (!this.box) return;
    this.box.x1 = x;
    const t = music.time;
    const a = Math.min(this.box.x0, this.box.x1);
    const b = Math.max(this.box.x0, this.box.x1);
    editor.select(
      editor.bm.hitObjects.filter((o) => {
        const ox = this.xAt(o.time, t);
        return ox >= a && ox <= b;
      }).map((o) => o.id),
      this.box.additive,
    );
  }

  pointerUp() {
    this.box = null;
  }

  pointerLeave() {}

  doubleClick(x: number, y: number) {
    const hit = this.hitTest(x, y, music.time);
    if (hit) music.seek(hit.time);
  }

  cancel() {
    if (!editor.placing) return false;
    editor.placing = null;
    editor.emit();
    return true;
  }
}
