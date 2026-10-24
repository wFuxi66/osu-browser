import { useEffect, useRef } from 'react';
import { music } from '../../audio/music';
import { waveformFor, WAVEFORM_BUCKET_MS } from '../../audio/waveform';
import { comboColourIndex } from '../../osu/processing';
import { objectEndTime, sliderSpanDuration, snapTime, tickColour, tickDivisorOf } from '../../osu/timing';
import type { HitObject, Rgb, TimingPoint } from '../../osu/types';
import { comboColours, skins } from '../../skin/skin';
import { onFrame } from '../playback';
import { drawHitCircle, rgba, shade } from '../render/draw';
import { editor, shiftObjectTime, snapSliderLength } from '../store';
import { fmt } from '../../osu/info';

/** Object row geometry as fractions of the timeline height. */
const OBJ_R = 0.32;
const OBJ_Y = 0.5;

type Drag =
  | { kind: 'move'; startTime: number; anchorTime: number; originals: Map<number, HitObject>; moved: boolean }
  | { kind: 'end'; obj: HitObject; original: HitObject; moved: boolean }
  | { kind: 'box'; t0: number; t1: number; additive: boolean }
  | { kind: 'scrub' };

export function Timeline() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(canvas);

    const off = onFrame((t) => {
      if (!editor.hasProject || w === 0) return;
      drawTimeline(ctx, w, h, t, dragRef.current);
    });

    const pxPerMs = () => (w / 5000) * editor.bm.editor.timelineZoom;
    const timeAt = (x: number) => music.time + (x - w / 2) / pxPerMs();
    const local = (e: PointerEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const hitTest = (x: number, y: number): { obj: HitObject; part: 'body' | 'end' | 'edge'; edge?: number } | null => {
      const bm = editor.bm;
      const t = music.time;
      const ppm = pxPerMs();
      const r = h * OBJ_R;
      const cy = h * OBJ_Y;
      if (Math.abs(y - cy) > r * 1.3) return null;
      let best: { obj: HitObject; part: 'body' | 'end' | 'edge'; edge?: number } | null = null;
      for (const o of bm.hitObjects) {
        const x0 = w / 2 + (o.time - t) * ppm;
        const end = objectEndTime(bm, o);
        const x1 = w / 2 + (end - t) * ppm;
        if (x1 < x - r || x0 > x + r) continue;
        if (o.kind !== 'circle' && Math.abs(x - x1) <= r) {
          best = { obj: o, part: 'end' };
          if (o.kind === 'slider') best.edge = o.slides;
        } else if (Math.abs(x - x0) <= r) best = { obj: o, part: 'body', edge: 0 };
        else if (x >= x0 && x <= x1) {
          best = { obj: o, part: 'body' };
          if (o.kind === 'slider') {
            const span = sliderSpanDuration(bm, o);
            for (let i = 1; i < o.slides; i++) {
              const xe = w / 2 + (o.time + span * i - t) * ppm;
              if (Math.abs(x - xe) <= r * 0.6) best = { obj: o, part: 'edge', edge: i };
            }
          }
        }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      if (!editor.hasProject) return;
      const { x, y } = local(e);
      // The timing view's timeline only seeks.
      if (editor.screen === 'timing') {
        if (e.button !== 0) return;
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = { kind: 'scrub' };
        music.seek(Math.round(snapTime(editor.bm, timeAt(x), editor.beatDivisor)));
        return;
      }
      const hit = hitTest(x, y);
      if (e.button === 2) {
        if (hit) editor.deleteObject(hit.obj.id);
        return;
      }
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const ctrl = e.ctrlKey || e.metaKey;
      if (!hit) {
        dragRef.current = { kind: 'box', t0: timeAt(x), t1: timeAt(x), additive: ctrl || e.shiftKey };
        if (!ctrl && !e.shiftKey) editor.clearSelection();
        return;
      }
      if (ctrl) {
        editor.toggleSelect(hit.obj.id);
        return;
      }
      const alreadySelected = editor.selection.has(hit.obj.id);
      if (!alreadySelected) editor.select([hit.obj.id]);
      // Clicking an edge of an already selected slider targets that edge for hitsounding.
      if (alreadySelected && hit.obj.kind === 'slider' && hit.edge !== undefined && editor.selection.size === 1) {
        editor.selectedEdge = { id: hit.obj.id, edge: hit.edge };
        editor.emit();
      }
      if (editor.locked) return;
      if (hit.part === 'end') {
        editor.beginChange();
        dragRef.current = { kind: 'end', obj: hit.obj, original: structuredClone(hit.obj), moved: false };
      } else {
        const originals = new Map<number, HitObject>();
        for (const o of editor.selectedObjects) originals.set(o.id, structuredClone(o));
        editor.beginChange();
        dragRef.current = { kind: 'move', startTime: timeAt(x), anchorTime: hit.obj.time, originals, moved: false };
      }
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const { x } = local(e);
      const bm = editor.bm;
      const raw = timeAt(x);
      const snap = (t: number) => (e.shiftKey ? Math.round(t) : Math.round(snapTime(bm, t, editor.beatDivisor)));
      if (d.kind === 'scrub') {
        // Seeking already happened on press; moving the strip under the cursor would run away.
      } else if (d.kind === 'box') {
        d.t1 = raw;
        const a = Math.min(d.t0, d.t1);
        const b = Math.max(d.t0, d.t1);
        editor.select(bm.hitObjects.filter((o) => o.time >= a && o.time <= b).map((o) => o.id), d.additive);
      } else if (d.kind === 'move') {
        const target = snap(d.anchorTime + (raw - d.startTime));
        const delta = target - d.anchorTime;
        for (const o of bm.hitObjects) {
          const orig = d.originals.get(o.id);
          if (!orig) continue;
          o.time = orig.time;
          if ((o.kind === 'spinner' || o.kind === 'hold') && 'endTime' in orig) o.endTime = orig.endTime;
          shiftObjectTime(o, delta);
        }
        if (delta !== 0) d.moved = true;
        editor.touch();
      } else if (d.kind === 'end') {
        const o = d.obj;
        const target = snap(raw);
        if (o.kind === 'spinner' || o.kind === 'hold') {
          o.endTime = Math.max(o.time + 1, target);
          d.moved = true;
        } else if (o.kind === 'slider' && d.original.kind === 'slider') {
          if (bm.general.mode === 1) {
            // Taiko drumrolls: change the length.
            const span0 = sliderSpanDuration(bm, d.original);
            const newDur = Math.max(1, target - o.time);
            o.length = Math.max(1, (d.original.length * newDur) / Math.max(1, span0));
            o.points = [{ x: o.x + Math.round(o.length), y: o.y }];
            snapSliderLength(bm, o, editor.beatDivisor);
          } else {
            // Dragging the tail adds/removes repeats, like stable.
            const span = sliderSpanDuration(bm, o);
            const slides = Math.max(1, Math.round((target - o.time) / Math.max(1, span)));
            if (slides !== o.slides) {
              const es = d.original.edgeSounds;
              const ss = d.original.edgeSets;
              o.slides = slides;
              o.edgeSounds = Array.from({ length: slides + 1 }, (_, i) => es[Math.min(i, es.length - 1)] ?? 0);
              o.edgeSets = Array.from({ length: slides + 1 }, (_, i) => ({ ...(ss[Math.min(i, ss.length - 1)] ?? { normal: 0, addition: 0 }) }));
            }
          }
          d.moved = true;
        }
        editor.touch();
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.kind === 'move' || d.kind === 'end') {
        if (d.moved) editor.endChange();
        else editor.cancelChange();
      }
    };

    const onDbl = (e: MouseEvent) => {
      const { x, y } = local(e);
      const hit = hitTest(x, y);
      if (hit) music.seek(hit.obj.time);
      else music.seek(Math.round(snapTime(editor.bm, timeAt(x), editor.beatDivisor)));
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    return () => {
      off();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, []);

  return <canvas ref={canvasRef} className="timeline-canvas" data-wheel="timeline" />;
}

function drawWaveform(ctx: CanvasRenderingContext2D, w: number, h: number, tStart: number, ppm: number) {
  const wf = waveformFor(music.blob!);
  if (!wf) return;
  const { peaks } = wf;
  const mid = h / 2;
  ctx.fillStyle = 'rgba(102,204,255,0.22)';
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const a = Math.floor((tStart + x / ppm) / WAVEFORM_BUCKET_MS);
    const b = Math.max(a + 1, Math.floor((tStart + (x + 1) / ppm) / WAVEFORM_BUCKET_MS));
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) if (peaks[i] > m) m = peaks[i];
    if (m > 0) ctx.rect(x, mid - m * mid * 0.9, 1, m * h * 0.9);
  }
  ctx.fill();
}


function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, drag: Drag | null) {
  const bm = editor.bm;
  const ppm = (w / 5000) * bm.editor.timelineZoom;
  const tStart = t - w / 2 / ppm;
  const tEnd = t + w / 2 / ppm;
  const X = (time: number) => w / 2 + (time - t) * ppm;
  const timingView = editor.screen === 'timing';
  ctx.clearRect(0, 0, w, h);

  // Kiai and break shading
  const tps = bm.timingPoints;
  for (let i = 0; i < tps.length; i++) {
    if (!tps[i].kiai) continue;
    const next = tps.slice(i + 1).find((p) => !p.kiai);
    const a = X(tps[i].time);
    const b = X(next ? next.time : music.duration || tEnd);
    ctx.fillStyle = 'rgba(255,140,0,0.12)';
    ctx.fillRect(a, 0, b - a, h);
  }
  for (const br of bm.events.breaks) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(X(br.start), 0, X(br.end) - X(br.start), h);
  }

  if (editor.prefs.showWaveform && music.blob) drawWaveform(ctx, w, h, tStart, ppm);

  // Baseline and divisor ticks rising from it, coloured by snap like stable.
  const base = h - 1.5;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(0, base, w, 1.5);
  const divisor = editor.beatDivisor;
  const reds = tps.filter((p) => p.uninherited);
  for (let i = 0; i < reds.length; i++) {
    const red = reds[i];
    const segEnd = reds[i + 1]?.time ?? Infinity;
    const step = red.beatLength / divisor;
    if (!(step > 0)) continue;
    const from = Math.max(tStart, i === 0 ? -Infinity : red.time);
    const to = Math.min(tEnd, segEnd - 1);
    if (from > to) continue;
    const perBar = divisor * red.meter;
    for (let k = Math.ceil((from - red.time) / step); red.time + k * step <= to; k++) {
      const x = X(red.time + k * step);
      const kk = ((k % perBar) + perBar) % perBar;
      const d = tickDivisorOf(kk, divisor);
      const isBar = kk === 0;
      const len = isBar ? h * 0.3 : d === 1 ? h * 0.22 : d === 2 ? h * 0.16 : h * 0.11;
      ctx.strokeStyle = tickColour(d);
      ctx.lineWidth = isBar ? 2 : 1.25;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - len);
      ctx.stroke();
    }
  }

  if (timingView) drawTimingFlags(ctx, h, tps, X, w);
  else {
    // Timing points as short marks along the top.
    for (const tp of tps) {
      const x = X(tp.time);
      if (x < -2 || x > w + 2) continue;
      ctx.strokeStyle = tp.uninherited ? '#ff3c3c' : '#46d246';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h * 0.12);
      ctx.stroke();
    }
  }
  for (const b of bm.editor.bookmarks) {
    const x = X(b);
    ctx.strokeStyle = '#4aa8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.86);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  if (!timingView) drawObjects(ctx, h, t, tStart, tEnd, X);

  if (drag?.kind === 'box') {
    const a = X(Math.min(drag.t0, drag.t1));
    const b = X(Math.max(drag.t0, drag.t1));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(a, 0, b - a, h);
  }

  // Current time marker
  ctx.fillStyle = '#fff';
  ctx.fillRect(w / 2 - 1, 0, 2, h);
}

function drawObjects(ctx: CanvasRenderingContext2D, h: number, t: number, tStart: number, tEnd: number, X: (time: number) => number) {
  const bm = editor.bm;
  // A spinner waiting for its end click spans from its start to now.
  if (editor.placing?.kind === 'spinner') {
    const a = X(editor.placing.time);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(a, h * (OBJ_Y - OBJ_R), X(t) - a, h * OBJ_R * 2);
  }
  const proc = editor.processed;
  const cols = comboColours(bm);
  const r = h * OBJ_R;
  const cy = h * OBJ_Y;
  const objs = bm.hitObjects;
  const ring = (x: number, rad: number, colour: string, width: number) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
  };
  const disc = (x: number, rad: number, c: Rgb) => {
    const g = ctx.createRadialGradient(x, cy - rad * 0.3, rad * 0.1, x, cy, rad);
    g.addColorStop(0, rgba(shade(c, 0.3)));
    g.addColorStop(1, rgba(shade(c, -0.15)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  // Like stable, osu!standard circles in the timeline use the skin (hitcircle + overlay + number) when one is chosen.
  const skinned = bm.general.mode === 0 && editor.prefs.skinnedTimeline && !!skins.current?.get('hitcircle');
  /** A circle on the timeline: skinned, or a shaded disc with a white ring; `highlight` rings it in that colour. */
  const circle = (x: number, rad: number, c: Rgb, label: string | null, highlight: string | null) => {
    if (skinned) {
      drawHitCircle(ctx, x, cy, rad, c, 1, label, false);
      if (highlight) ring(x, rad, highlight, 3);
      return;
    }
    disc(x, rad, c);
    ring(x, rad - 1.5, highlight ?? '#fff', highlight ? 4 : 2.5);
  };
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    const end = proc.info.get(o.id)?.endTime ?? o.time;
    if (end < tStart - 1000 || o.time > tEnd + 1000) continue;
    const x0 = X(o.time);
    const x1 = X(end);
    const sel = editor.selection.has(o.id);
    const colour: Rgb = bm.general.mode === 1
      ? (o.hitSound & 10 ? { r: 68, g: 138, b: 202 } : { r: 235, g: 69, b: 44 })
      : o.kind === 'spinner'
        ? { r: 200, g: 200, b: 200 }
        : cols[comboColourIndex(o, proc, cols.length)];
    const big = bm.general.mode === 1 && o.hitSound & 4 ? 1.2 : 1;
    if (o.kind !== 'circle') {
      // Body: a rounded bar in the combo colour, like stable's timeline sliders.
      ctx.fillStyle = rgba(colour, 0.55);
      ctx.beginPath();
      ctx.moveTo(x0, cy - r);
      ctx.lineTo(x1, cy - r);
      ctx.arc(x1, cy, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x0, cy + r);
      ctx.arc(x0, cy, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = '#ffa500';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (o.kind === 'slider') {
        const span = sliderSpanDuration(bm, o);
        for (let s = 1; s <= o.slides; s++) {
          const xe = X(o.time + span * s);
          const edgeSel = editor.selectedEdge?.id === o.id && editor.selectedEdge.edge === s;
          const rad = s === o.slides ? r * 0.92 : r * 0.6;
          circle(xe, rad, colour, null, edgeSel ? '#ffa500' : null);
        }
      } else {
        circle(x1, r * 0.92, colour, null, sel ? '#ffa500' : null);
      }
    }
    // Head
    const headSel = editor.selectedEdge?.id === o.id && editor.selectedEdge.edge === 0;
    const number = o.kind !== 'spinner' ? proc.info.get(o.id)?.comboNumber : undefined;
    circle(x0, r * big * 0.92, colour, skinned && number ? String(number) : null, sel || headSel ? '#ffa500' : null);
    if (!skinned && (bm.general.mode === 0 || bm.general.mode === 2)) {
      const n = proc.info.get(o.id)?.comboNumber;
      if (n && o.kind !== 'spinner') {
        ctx.fillStyle = '#fff';
        ctx.font = `400 ${Math.round(r * 1.05)}px Ubuntu, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 3;
        ctx.fillText(String(n), x0, cy + 1);
        ctx.shadowBlur = 0;
      }
    }
    // Hitsound additions as small letters under the object
    const add = o.kind === 'slider' ? o.edgeSounds[0] ?? o.hitSound : o.hitSound;
    const letters = `${add & 2 ? 'W' : ''}${add & 4 ? 'F' : ''}${add & 8 ? 'C' : ''}`;
    if (letters && bm.general.mode !== 1) {
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(h * 0.13)}px Ubuntu, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(letters, x0, cy + r + 1);
    }
  }
}

/** Timing view: each timing point as a line with a flag showing its BPM (red) or slider velocity (green). */
function drawTimingFlags(ctx: CanvasRenderingContext2D, h: number, tps: TimingPoint[], X: (time: number) => number, w: number) {
  ctx.font = `400 ${Math.round(h * 0.2)}px Ubuntu, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const tp of tps) {
    const x = X(tp.time);
    if (x < -200 || x > w + 10) continue;
    const label = tp.uninherited ? `${fmt(60000 / tp.beatLength, 2)}` : `${fmt(-100 / tp.beatLength, 2)}X`;
    const fy = tp.uninherited ? h * 0.06 : h * 0.3;
    const fh = h * 0.3;
    const tw = ctx.measureText(label).width + h * 0.3;
    ctx.fillStyle = tp.uninherited ? '#e03030' : '#3a9a3a';
    ctx.fillRect(x - 1, 0, 2, h);
    ctx.fillStyle = tp.uninherited ? 'rgba(230,80,80,0.95)' : 'rgba(205,225,250,0.92)';
    ctx.beginPath();
    ctx.roundRect(x, fy, tw, fh, [0, fh / 2, fh / 2, 0]);
    ctx.fill();
    ctx.fillStyle = tp.uninherited ? '#fff' : '#334';
    ctx.fillText(label, x + h * 0.12, fy + fh / 2 + 1);
  }
}
