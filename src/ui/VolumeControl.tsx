// stable's volume overlay: Alt+wheel shows master/music/effect meters in the bottom right and changes the
// one under the cursor (master otherwise). While it's showing, the wheel over a meter changes it without Alt.
// In the editor, Alt+wheel only reaches it in the bottom-right corner; elsewhere it stays the editor's.
import { useEffect, useRef, useState } from 'react';
import { editor, useEditor } from '../editor/store';
import { activePlayfield } from '../editor/ui/Playfield';
import { gameplay } from '../play/session';
import type { Prefs } from '../project/storage';

type Meter = 'master' | 'music' | 'effect';

const KEYS: Record<Meter, keyof Prefs> = { master: 'masterVolume', music: 'musicVolume', effect: 'hitsoundVolume' };
const STEP = 0.05;
const HIDE_AFTER = 1000;

// Meter layout in an SVG anchored to the bottom-right corner (units: 1/1000 of the window height).
const BACKDROP = { cx: -12, cy: 8, r: 205 };
const METERS: Record<Meter, { cx: number; cy: number; r: number; label: { x: number; y: number; size: number }; text: number }> = {
  master: { cx: -118, cy: -118, r: 58, label: { x: -190, y: -78, size: 21 }, text: 27 },
  music: { cx: -182, cy: -230, r: 30, label: { x: -224, y: -229, size: 21 }, text: 11 },
  effect: { cx: -240, cy: -158, r: 28, label: { x: -280, y: -157, size: 21 }, text: 11 },
};

/** Which meter the pointer is over, if any (hit-tested on the meter discs and their labels). */
function meterAt(x: number, y: number): Meter | null {
  const unit = window.innerHeight / 1000;
  const lx = (x - window.innerWidth) / unit;
  const ly = (y - window.innerHeight) / unit;
  for (const m of ['music', 'effect', 'master'] as Meter[]) {
    const { cx, cy, r } = METERS[m];
    if (Math.hypot(lx - cx, ly - cy) <= r + 8) return m;
  }
  return null;
}

/** Whether the pointer is over the overlay's backdrop in the bottom-right corner. */
function inCorner(x: number, y: number): boolean {
  const unit = window.innerHeight / 1000;
  return Math.hypot((x - window.innerWidth) / unit - BACKDROP.cx, (y - window.innerHeight) / unit - BACKDROP.cy) <= BACKDROP.r;
}

/** Whether the wheel is over an editor area that uses Alt+wheel itself. */
function editorWheelAt(e: WheelEvent): boolean {
  const area = (e.target as HTMLElement).closest?.<HTMLElement>('[data-wheel]');
  // The timing screen has no distance spacing, so Alt+wheel there is the volume.
  if (!area || area.dataset.wheel === 'timing') return false;
  if (!area.classList.contains('playfield-canvas')) return true;
  const r = area.getBoundingClientRect();
  return activePlayfield.current?.inPlayfield?.(e.clientX - r.left, e.clientY - r.top) ?? true;
}

export function VolumeControl() {
  const ed = useEditor();
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState<Meter | null>(null);
  const hideTimer = useRef(0);
  const state = useRef({ visible, hover });
  state.current = { visible, hover };

  useEffect(() => {
    const show = () => {
      setVisible(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (!state.current.hover) setVisible(false);
      }, HIDE_AFTER);
    };
    const onWheel = (e: WheelEvent) => {
      const over = state.current.visible ? meterAt(e.clientX, e.clientY) : null;
      // While playing, the wheel alone changes the volume, as in stable (unless "Disable mouse wheel in play mode").
      const playing = gameplay.active && !editor.prefs.disableWheelInPlay && !e.ctrlKey && !e.metaKey;
      if (!over && !playing) {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        // Alt+wheel over the playfield or timeline stays the editor's (distance spacing, zoom) outside the
        // bottom-right corner, as in stable. Around the playfield (the canvas covers the whole stage) it's the volume.
        if (editor.hasProject && editorWheelAt(e) && !inCorner(e.clientX, e.clientY)) return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const meter = over ?? 'master';
      const key = KEYS[meter];
      const delta = (e.deltaY || e.deltaX) < 0 ? STEP : -STEP;
      const value = Math.round(Math.min(1, Math.max(0, (editor.prefs[key] as number) + delta)) * 100) / 100;
      editor.setPrefs({ [key]: value });
      show();
    };
    const onMove = (e: PointerEvent) => {
      if (!state.current.visible) return;
      const over = meterAt(e.clientX, e.clientY);
      if (over !== state.current.hover) setHover(over);
      if (!over && state.current.hover) show();
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  const p = ed.prefs;
  const values: Record<Meter, number> = { master: p.masterVolume, music: p.musicVolume, effect: p.hitsoundVolume };

  return (
    <div className={`volume-control ${visible ? 'shown' : ''}`} aria-hidden={!visible}>
      <svg viewBox="-420 -420 420 420" preserveAspectRatio="xMaxYMax meet">
        <defs>
          <filter id="vc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={BACKDROP.cx} cy={BACKDROP.cy} r={BACKDROP.r} className="vc-backdrop" />
        {(Object.keys(METERS) as Meter[]).map((m) => {
          const { cx, cy, r, label, text } = METERS[m];
          const ring = r * 0.84;
          const width = Math.max(4, r * 0.13);
          const circumference = 2 * Math.PI * ring;
          const pct = Math.round(values[m] * 100);
          return (
            <g key={m} className={`vc-meter ${hover === m ? 'hover' : ''}`}>
              <circle cx={cx} cy={cy} r={r} className="vc-disc" />
              <circle cx={cx} cy={cy} r={ring} className="vc-track" strokeWidth={width} />
              <circle
                cx={cx}
                cy={cy}
                r={ring}
                className="vc-arc"
                strokeWidth={width}
                strokeDasharray={`${(circumference * pct) / 100} ${circumference}`}
                transform={`rotate(-90 ${cx} ${cy})`}
                filter="url(#vc-glow)"
              />
              <text x={cx} y={cy} className="vc-pct" fontSize={text} dominantBaseline="central" textAnchor="middle">
                {pct}%
              </text>
              <text x={label.x} y={label.y} className="vc-label" fontSize={label.size} textAnchor="end" dominantBaseline="central">
                {m}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
