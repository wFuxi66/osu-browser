import { useEffect, useRef } from 'react';
import { music } from '../../audio/music';
import { waveformFor, WAVEFORM_BUCKET_MS } from '../../audio/waveform';
import { comboColourIndex } from '../../osu/processing';
import { objectEndTime, sliderSpanDuration, snapTime, tickColour, tickDivisorOf } from '../../osu/timing';
import { DEFAULT_COMBO_COLOURS, type HitObject } from '../../osu/types';
import { onFrame } from '../playback';
import { rgba, shade } from '../render/draw';
import { editor, shiftObjectTime, snapSliderLength } from '../store';

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
      const r = h * 0.26;
      const cy = h * 0.5;
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
      if (d.kind === 'box') {
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
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#16161c';
  ctx.fillRect(0, 0, w, h);

  // Kiai and break shading
  const tps = bm.timingPoints;
  for (let i = 0; i < tps.length; i++) {
    if (!tps[i].kiai) continue;
    const next = tps.slice(i + 1).find((p) => !p.kiai);
    const a = X(tps[i].time);
    const b = X(next ? next.time : music.duration || tEnd);
    ctx.fillStyle = 'rgba(255,140,0,0.08)';
    ctx.fillRect(a, 0, b - a, h);
  }
  for (const br of bm.events.breaks) {
    ctx.fillStyle = 'rgba(120,120,255,0.08)';
    ctx.fillRect(X(br.start), 0, X(br.end) - X(br.start), h);
  }

  if (editor.prefs.showWaveform && music.blob) drawWaveform(ctx, w, h, tStart, ppm);

  // Divisor ticks
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
      const len = isBar ? h * 0.42 : d === 1 ? h * 0.32 : d === 2 ? h * 0.24 : h * 0.18;
      ctx.strokeStyle = tickColour(d);
      ctx.globalAlpha = isBar ? 1 : 0.8;
      ctx.lineWidth = isBar ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - len);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, len * 0.35);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Timing points
  for (const tp of tps) {
    const x = X(tp.time);
    if (x < -2 || x > w + 2) continue;
    ctx.strokeStyle = tp.uninherited ? '#ff3c3c' : '#46d246';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h * 0.18);
    ctx.stroke();
  }
  for (const b of bm.editor.bookmarks) {
    const x = X(b);
    ctx.strokeStyle = '#4aa8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.82);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // A spinner waiting for its end click spans from its start to now.
  if (editor.placing?.kind === 'spinner') {
    const a = X(editor.placing.time);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(a, h * 0.25, X(t) - a, h * 0.5);
    ctx.strokeRect(a, h * 0.25, X(t) - a, h * 0.5);
  }

  // Objects
  const proc = editor.processed;
  const cols = bm.colours.combo.length ? bm.colours.combo : DEFAULT_COMBO_COLOURS;
  const r = h * 0.26;
  const cy = h * 0.5;
  const objs = bm.hitObjects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    const end = proc.info.get(o.id)?.endTime ?? o.time;
    if (end < tStart - 1000 || o.time > tEnd + 1000) continue;
    const x0 = X(o.time);
    const x1 = X(end);
    const sel = editor.selection.has(o.id);
    const colour = bm.general.mode === 1
      ? (o.hitSound & 10 ? { r: 68, g: 138, b: 202 } : { r: 235, g: 69, b: 44 })
      : o.kind === 'spinner'
        ? { r: 160, g: 160, b: 160 }
        : cols[comboColourIndex(bm, o, proc)];
    if (o.kind !== 'circle') {
      ctx.fillStyle = rgba(shade(colour, -0.35));
      ctx.strokeStyle = sel ? '#ffd400' : '#fff';
      ctx.lineWidth = sel ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, cy - r);
      ctx.lineTo(x1, cy - r);
      ctx.arc(x1, cy, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x0, cy + r);
      ctx.arc(x0, cy, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (o.kind === 'slider') {
        const span = sliderSpanDuration(bm, o);
        for (let s = 1; s <= o.slides; s++) {
          const xe = X(o.time + span * s);
          const edgeSel = editor.selectedEdge?.id === o.id && editor.selectedEdge.edge === s;
          ctx.fillStyle = rgba(colour);
          ctx.strokeStyle = edgeSel ? '#ffd400' : '#fff';
          ctx.lineWidth = edgeSel ? 3 : 1.5;
          ctx.beginPath();
          ctx.arc(xe, cy, s === o.slides ? r * 0.85 : r * 0.55, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    // Head
    ctx.fillStyle = rgba(colour);
    ctx.strokeStyle = sel ? '#ffd400' : '#fff';
    const headSel = editor.selectedEdge?.id === o.id && editor.selectedEdge.edge === 0;
    ctx.lineWidth = sel || headSel ? 3 : 2;
    ctx.beginPath();
    const big = bm.general.mode === 1 && o.hitSound & 4 ? 1.25 : 1;
    ctx.arc(x0, cy, r * big, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (bm.general.mode === 0 || bm.general.mode === 2) {
      const n = proc.info.get(o.id)?.comboNumber;
      if (n && o.kind !== 'spinner') {
        ctx.fillStyle = '#fff';
        ctx.font = `600 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), x0, cy + 1);
      }
    }
    // Hitsound additions as small letters under the object
    const add = o.kind === 'slider' ? o.edgeSounds[0] ?? o.hitSound : o.hitSound;
    const letters = `${add & 2 ? 'W' : ''}${add & 4 ? 'F' : ''}${add & 8 ? 'C' : ''}`;
    if (letters && bm.general.mode !== 1) {
      ctx.fillStyle = '#ddd';
      ctx.font = `600 ${Math.round(h * 0.16)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(letters, x0, cy + r + 2);
    }
  }

  if (drag?.kind === 'box') {
    const a = X(Math.min(drag.t0, drag.t1));
    const b = X(Math.max(drag.t0, drag.t1));
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(a, 0, b - a, h);
  }

  // Current time marker
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
}
