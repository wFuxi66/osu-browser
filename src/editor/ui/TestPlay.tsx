import { useEffect, useRef, useState } from 'react';
import { music } from '../../audio/music';
import { dist, getSliderPath, sliderPositionAtSpan } from '../../osu/curves';
import { comboColourIndex, hitWindows, sliderTickProgresses, stackedPosition } from '../../osu/processing';
import { objectEndTime, sliderSpanDuration } from '../../osu/timing';
import { DEFAULT_COMBO_COLOURS, type HitObject, type Vec2 } from '../../osu/types';
import { onFrame } from '../playback';
import { ManiaMode } from '../playfield/maniaMode';
import { TaikoMode } from '../playfield/taikoMode';
import { drawApproachCircle, drawFollowPoints, drawHitCircle, drawReverseArrow, drawSliderBody, rgba, toOsu, toScreen, type View } from '../render/draw';
import { editor, PLAYFIELD_H, PLAYFIELD_W } from '../store';
import { drawBackground } from './Playfield';

type Judgement = 300 | 100 | 50 | 0;

interface ObjState {
  judged: boolean;
  result?: Judgement;
  headHit?: boolean;
  ticksHit: number;
  ticksTotal: number;
  spin: number;
}

interface Popup {
  pos: Vec2;
  time: number;
  value: Judgement;
}

/** F5 test mode. osu!standard is fully playable; other modes run as an autoplay preview. */
export function TestPlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const [hud, setHud] = useState({ combo: 0, acc: 100, score: 0, counts: [0, 0, 0, 0] });
  const startTime = useRef(music.time);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const bm = editor.bm;
    const proc = editor.processed;
    const mode = bm.general.mode;
    let w = 0;
    let h = 0;
    let view: View = { scale: 1, ox: 0, oy: 0 };
    const altSurface = mode === 3 ? new ManiaMode() : mode === 1 ? new TaikoMode() : null;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(w / 640, h / 480);
      view = { scale, ox: (w - PLAYFIELD_W * scale) / 2, oy: (h - PLAYFIELD_H * scale) / 2 + 8 * scale };
      altSurface?.layout(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    const windows = hitWindows(bm.difficulty.overallDifficulty);
    const r = proc.radius;
    const states = new Map<number, ObjState>();
    for (const o of bm.hitObjects) {
      const ticks = o.kind === 'slider' ? sliderTickProgresses(bm, o).length * o.slides + o.slides : 0;
      states.set(o.id, { judged: o.time < startTime.current - 50, ticksHit: 0, ticksTotal: ticks, spin: 0 });
    }
    const popups: Popup[] = [];
    const counts = [0, 0, 0, 0];
    let combo = 0;
    let score = 0;
    let cursor: Vec2 = { x: 256, y: 192 };
    let keysDown = 0;
    let lastAngle: number | null = null;

    const judge = (o: HitObject, value: Judgement, pos: Vec2, t: number) => {
      const s = states.get(o.id)!;
      if (s.judged) return;
      s.judged = true;
      s.result = value;
      counts[value === 300 ? 0 : value === 100 ? 1 : value === 50 ? 2 : 3]++;
      combo = value === 0 ? 0 : combo + 1;
      score += value * (1 + combo / 25);
      popups.push({ pos, time: t, value });
      const total = counts[0] + counts[1] + counts[2] + counts[3];
      const acc = total ? ((counts[0] * 300 + counts[1] * 100 + counts[2] * 50) / (total * 300)) * 100 : 100;
      setHud({ combo, acc, score: Math.round(score), counts: [...counts] });
    };

    const tryHit = (t: number) => {
      // The earliest unjudged object whose head is under the cursor gets the hit (notelock-like).
      for (const o of bm.hitObjects) {
        const s = states.get(o.id)!;
        if (s.judged || s.headHit || o.kind === 'spinner') continue;
        if (o.time - t > windows.meh) break;
        const pos = stackedPosition(o, proc);
        if (dist(cursor, pos) > r) return;
        const err = Math.abs(t - o.time);
        const value: Judgement = err <= windows.great ? 300 : err <= windows.ok ? 100 : err <= windows.meh ? 50 : 0;
        if (o.kind === 'slider') {
          s.headHit = value > 0;
          if (value > 0) {
            combo++;
            s.ticksHit++;
          }
        } else judge(o, value, pos, t);
        return;
      }
    };

    const update = (t: number) => {
      if (autoRef.current) {
        // Autoplay: move the cursor along the objects.
        const next = bm.hitObjects.find((o) => objectEndTime(bm, o) >= t);
        if (next) {
          if (next.kind === 'spinner' && t >= next.time) {
            const a = (t - next.time) / 40;
            cursor = { x: 256 + Math.cos(a) * 60, y: 192 + Math.sin(a) * 60 };
          } else if (next.kind === 'slider' && t >= next.time) {
            const span = sliderSpanDuration(bm, next);
            const sh = (proc.info.get(next.id)?.stackHeight ?? 0) * proc.stackOffset;
            const p = sliderPositionAtSpan(next, (t - next.time) / Math.max(1, span));
            cursor = { x: p.x + sh, y: p.y + sh };
          } else {
            const prev = [...bm.hitObjects].reverse().find((o) => objectEndTime(bm, o) < t);
            const from = prev ? (prev.kind === 'slider' ? proc.info.get(prev.id)!.endPos : stackedPosition(prev, proc)) : cursor;
            const to = next.kind === 'spinner' ? { x: 256, y: 192 } : stackedPosition(next, proc);
            const t0 = prev ? objectEndTime(bm, prev) : t;
            const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1, next.time - t0)));
            cursor = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
          }
          if (next.kind !== 'spinner' && Math.abs(t - next.time) < 8 && !states.get(next.id)!.headHit) tryHit(next.time);
        }
        keysDown = 1;
      }

      for (const o of bm.hitObjects) {
        const s = states.get(o.id)!;
        if (s.judged) continue;
        if (o.time - t > windows.meh) break;
        const end = objectEndTime(bm, o);
        if (o.kind === 'circle' && t > o.time + windows.meh) judge(o, 0, stackedPosition(o, proc), t);
        if (o.kind === 'slider') {
          const span = sliderSpanDuration(bm, o);
          if (t > o.time + windows.meh && !s.headHit && !s.judged) {
            s.headHit = false;
            combo = 0;
          }
          if (t >= o.time && t <= end && span > 0) {
            const sh = (proc.info.get(o.id)?.stackHeight ?? 0) * proc.stackOffset;
            const p = sliderPositionAtSpan(o, (t - o.time) / span);
            const following = keysDown > 0 && dist(cursor, { x: p.x + sh, y: p.y + sh }) < r * 2.4;
            if (following) s.ticksHit += 1 / 30; // approximate tick tracking by time followed
          }
          if (t > end) {
            const followed = Math.min(1, s.ticksHit / Math.max(1, ((end - o.time) / 1000) * 2));
            const headOk = s.headHit ? 1 : 0;
            const ratio = (headOk + followed * 2) / 3;
            const value: Judgement = ratio > 0.95 ? 300 : ratio > 0.5 ? 100 : ratio > 0 ? 50 : 0;
            judge(o, value, proc.info.get(o.id)!.endPos, t);
          }
        }
        if (o.kind === 'spinner') {
          if (t >= o.time && t <= o.endTime) {
            const a = Math.atan2(cursor.y - 192, cursor.x - 256);
            if (lastAngle !== null && keysDown > 0) {
              let d = a - lastAngle;
              if (d > Math.PI) d -= 2 * Math.PI;
              if (d < -Math.PI) d += 2 * Math.PI;
              s.spin += Math.abs(d);
            }
            lastAngle = a;
          }
          if (t > o.endTime) {
            const needed = ((o.endTime - o.time) / 1000) * 1.5 * Math.PI * 2;
            const ratio = s.spin / Math.max(1, needed);
            judge(o, ratio >= 1 ? 300 : ratio > 0.7 ? 100 : ratio > 0.3 ? 50 : 0, { x: 256, y: 192 }, t);
            lastAngle = null;
          }
        }
      }
    };

    const drawStd = (t: number) => {
      const visible = bm.hitObjects.filter((o) => {
        const end = objectEndTime(bm, o);
        return o.time - proc.preempt <= t && end + 200 >= t;
      });
      const cols = bm.colours.combo.length ? bm.colours.combo : DEFAULT_COMBO_COLOURS;
      const R = r * view.scale;
      for (let i = 0; i < visible.length - 1; i++) {
        const a = visible[i];
        const b = visible[i + 1];
        if (b.kind === 'spinner' || a.kind === 'spinner' || proc.info.get(b.id)!.comboNumber === 1) continue;
        const ap = a.kind === 'slider' ? proc.info.get(a.id)!.endPos : stackedPosition(a, proc);
        drawFollowPoints(ctx, toScreen(view, ap), toScreen(view, stackedPosition(b, proc)), R, 0.6);
      }
      for (let i = visible.length - 1; i >= 0; i--) {
        const o = visible[i];
        const s = states.get(o.id)!;
        const appear = o.time - proc.preempt;
        const alpha = Math.min(1, (t - appear) / proc.fadeIn);
        if (s.judged && o.kind !== 'slider') continue;
        const colour = cols[comboColourIndex(bm, o, proc)];
        if (o.kind === 'spinner') {
          const c = toScreen(view, { x: 256, y: 192 });
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          const prog = t < o.time ? 1 : Math.max(0, 1 - (t - o.time) / (o.endTime - o.time));
          ctx.arc(c.x, c.y, 180 * view.scale * prog + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = `600 ${Math.round(24 * view.scale)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(`${Math.floor(s.spin / (Math.PI * 2))}`, c.x, c.y + 60 * view.scale);
          ctx.restore();
          continue;
        }
        const pos = stackedPosition(o, proc);
        const sp = toScreen(view, pos);
        if (o.kind === 'slider') {
          const sh = (proc.info.get(o.id)?.stackHeight ?? 0) * proc.stackOffset;
          const path = getSliderPath(o);
          const pts = path.points.map((q) => toScreen(view, { x: q.x + sh, y: q.y + sh }));
          const end = objectEndTime(bm, o);
          const fade = t > end ? Math.max(0, 1 - (t - end) / 200) : 1;
          drawSliderBody(ctx, pts, R, bm.colours.sliderTrackOverride ?? colour, bm.colours.sliderBorder ?? { r: 255, g: 255, b: 255 }, alpha * fade * 0.9, false);
          const span = sliderSpanDuration(bm, o);
          if (o.slides > 1 && t < o.time + span * (o.slides - 1)) drawReverseArrow(ctx, pts[pts.length - 1], pts[Math.max(0, pts.length - 2)], R, alpha * fade);
          if (t < o.time && !s.headHit) drawHitCircle(ctx, sp.x, sp.y, R, colour, alpha, String(proc.info.get(o.id)?.comboNumber ?? ''), false);
          if (t >= o.time && t <= end && span > 0) {
            const b = sliderPositionAtSpan(o, (t - o.time) / span);
            const bp = toScreen(view, { x: b.x + sh, y: b.y + sh });
            ctx.save();
            ctx.fillStyle = rgba(colour, 0.9);
            ctx.beginPath();
            ctx.arc(bp.x, bp.y, R * 0.85, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(bp.x, bp.y, R * 2.4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        } else {
          drawHitCircle(ctx, sp.x, sp.y, R, colour, alpha, String(proc.info.get(o.id)?.comboNumber ?? ''), false);
        }
        if (t < o.time && !s.headHit) {
          const prog = (o.time - t) / proc.preempt;
          drawApproachCircle(ctx, sp.x, sp.y, R * (1 + 3 * prog), colour, alpha);
        }
      }
      // Judgement popups
      for (const p of popups) {
        const age = t - p.time;
        if (age > 600 || age < 0) continue;
        const s = toScreen(view, p.pos);
        ctx.save();
        ctx.globalAlpha = 1 - age / 600;
        ctx.font = `700 ${Math.round(22 * view.scale)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillStyle = p.value === 300 ? '#66ccff' : p.value === 100 ? '#88ff66' : p.value === 50 ? '#ffcc44' : '#ff4444';
        ctx.fillText(p.value === 0 ? '✕' : String(p.value), s.x, s.y - age * 0.02 * view.scale);
        ctx.restore();
      }
      // Cursor
      const c = toScreen(view, cursor);
      ctx.save();
      ctx.fillStyle = '#ffd400';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 10 * view.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const off = onFrame((t) => {
      drawBackground(ctx, w, h, Math.max(0.6, editor.prefs.backgroundDim), t);
      if (altSurface) {
        altSurface.draw(ctx, t);
        return;
      }
      update(t);
      drawStd(t);
    });

    const onMove = (e: PointerEvent) => {
      if (autoRef.current) return;
      const rect = canvas.getBoundingClientRect();
      cursor = toOsu(view, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const press = () => {
      if (autoRef.current) return;
      keysDown++;
      tryHit(music.time);
    };
    const release = () => (keysDown = Math.max(0, keysDown - 1));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape' || e.key === 'F5') {
        e.preventDefault();
        e.stopPropagation();
        exit();
        return;
      }
      if (['z', 'x', 'Z', 'X'].includes(e.key)) {
        e.stopPropagation();
        press();
      }
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        music.toggle();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => ['z', 'x', 'Z', 'X'].includes(e.key) && release();
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) press();
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) release();
    };
    const exit = () => {
      music.pause();
      music.seek(startTime.current);
      editor.openDialog(null);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    // Start a little before the current time so the first objects can be read.
    music.seek(Math.max(0, startTime.current - Math.max(1000, proc.preempt)));
    void music.play();

    return () => {
      off();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return (
    <div className="testplay">
      <canvas ref={ref} />
      <div className="testplay-hud">
        <div className="score">{hud.score.toString().padStart(8, '0')}</div>
        <div className="acc">{hud.acc.toFixed(2)}%</div>
        <div className="counts">300: {hud.counts[0]} · 100: {hud.counts[1]} · 50: {hud.counts[2]} · miss: {hud.counts[3]}</div>
      </div>
      <div className="testplay-combo">{hud.combo}x</div>
      <div className="testplay-bar">
        <label><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Autoplay</label>
        <span>Z / X or mouse buttons to hit · Space pause · Esc back to editor</span>
      </div>
    </div>
  );
}
