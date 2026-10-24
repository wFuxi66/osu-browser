import { useEffect, useRef, useState } from 'react';
import { music } from '../../audio/music';
import { fmt } from '../../osu/info';
import { redLineAt, svAt } from '../../osu/timing';
import { onFrame } from '../playback';
import { layoutCode } from '../shortcuts';
import { editor, useEditor } from '../store';

const TICK_RATES = [0.5, 1, 2, 3, 4, 6, 8];

/** Tap tempo shared by the T key and the "Tap Here!" button. */
const taps: number[] = [];

function tap() {
  const ed = editor;
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  const hasRed = ed.bm.timingPoints.some((t) => t.uninherited);
  // With no timing yet, the first tap places the first red line.
  if (!hasRed) {
    ed.addTimingPoint(true, Math.round(music.time));
    return;
  }
  if (taps.length >= 4) {
    const bpm = ((60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0])) * music.rate;
    ed.adjustCurrentRedLine({ beatLength: 60000 / Math.round(bpm) });
  }
}

/** F3: stable's timing view with BPM/offset/slider settings and a slider velocity preview. */
export function TimingScreen() {
  const ed = useEditor();
  const bm = ed.bm;
  const hasRed = bm.timingPoints.some((t) => t.uninherited);
  const red = hasRed ? redLineAt(bm, music.time) : null;
  const [, force] = useState(0);
  useEffect(() => music.onChange(() => force((n) => n + 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (layoutCode(e) === 'KeyT' && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !editor.dialog) {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const mod = (e: React.MouseEvent, base: number, shift: number, ctrl: number) => (e.ctrlKey ? ctrl : e.shiftKey ? shift : base);
  const bpm = red ? 60000 / red.beatLength : 0;
  const d = bm.difficulty;

  return (
    <div className="tm">
      <div className="tm-panel">
        <div className="tm-grid">
          <span className="tm-label">BPM:</span>
          <Spinner
            value={red ? fmt(bpm, 3) : '—'}
            disabled={!red}
            onStep={(dir, e) => red && ed.adjustCurrentRedLine({ beatLength: 60000 / Math.max(1, bpm + dir * mod(e, 1, 5, 0.25)) })}
            onEdit={(v) => v > 0 && ed.adjustCurrentRedLine({ beatLength: 60000 / v })}
          />
          <button className="tm-setup" onClick={() => ed.openDialog('timingPoints')}>
            <span>Timing Setup</span>
            <span>Panel</span>
          </button>
          <p className="tm-note">Note: you should resnap all notes from the timing menu after changing the BPM.</p>
          <span className="tm-label">Offset:</span>
          <Spinner
            value={red ? String(Math.round(red.time)) : '—'}
            disabled={!red}
            onStep={(dir, e) => red && ed.adjustCurrentRedLine({ time: red.time + dir * mod(e, 2, 10, 1) })}
            onEdit={(v) => ed.adjustCurrentRedLine({ time: v })}
          />
          <button className={`tm-check ${ed.moveNotesWithTiming ? 'on' : ''}`} onClick={() => { ed.moveNotesWithTiming = !ed.moveNotesWithTiming; ed.emit(); }}>
            <span className="tm-dot" /> Move already placed notes when changing the offset/BPM
          </button>
          <div className="tm-gap" />
          <span className="tm-label">Slider Velocity:</span>
          <Spinner
            value={fmt(d.sliderMultiplier, 2)}
            onStep={(dir, e) => ed.commit((b) => (b.difficulty.sliderMultiplier = clampSv(b.difficulty.sliderMultiplier + dir * mod(e, 0.1, 0.1, 0.01))))}
            onEdit={(v) => ed.commit((b) => (b.difficulty.sliderMultiplier = clampSv(v)))}
          />
          <span />
          <span className="tm-label">Slider Tick Rate:</span>
          <Spinner
            value={fmt(d.sliderTickRate, 1)}
            onStep={(dir) => {
              const i = TICK_RATES.indexOf(d.sliderTickRate);
              const j = Math.max(0, Math.min(TICK_RATES.length - 1, (i < 0 ? 1 : i) + dir));
              ed.commit((b) => (b.difficulty.sliderTickRate = TICK_RATES[j]));
            }}
            onEdit={(v) => v > 0 && ed.commit((b) => (b.difficulty.sliderTickRate = v))}
          />
        </div>
        <SliderPreview />
        {!red && <p className="tm-empty">No timing yet. Play the song and press <b>T</b> (or Tap Here!) on the first downbeat, or add a timing point with <b>Ctrl+P</b>.</p>}
      </div>
    </div>
  );
}

const clampSv = (v: number) => Math.round(Math.max(0.4, Math.min(3.6, v)) * 100) / 100;

function Spinner({ value, onStep, onEdit, disabled }: { value: string; onStep: (dir: 1 | -1, e: React.MouseEvent) => void; onEdit: (v: number) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`tm-spin ${disabled ? 'disabled' : ''}`}>
      <button onClick={(e) => onStep(-1, e)} disabled={disabled} aria-label="Decrease">‹</button>
      {editing ? (
        <input
          autoFocus
          defaultValue={value.replace(/\s/g, '')}
          onFocus={(e) => e.target.select()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const v = Number((e.target as HTMLInputElement).value.replace(',', '.'));
              if (Number.isFinite(v)) onEdit(v);
              setEditing(false);
            } else if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className="tm-spin-value" onClick={() => !disabled && setEditing(true)}>{value}</span>
      )}
      <button onClick={(e) => onStep(1, e)} disabled={disabled} aria-label="Increase">›</button>
    </div>
  );
}

/** A slider two beats long at the base velocity; the ball travels in time with the song. */
function SliderPreview() {
  const ball = useRef<HTMLDivElement>(null);
  const ed = useEditor();
  const bm = ed.bm;
  const sv = bm.difficulty.sliderMultiplier * (bm.timingPoints.length ? svAt(bm, music.time) : 1);
  const ticks = Math.max(1, Math.round(bm.difficulty.sliderTickRate * 2));
  useEffect(
    () =>
      onFrame((t) => {
        const el = ball.current;
        if (!el || !editor.hasProject) return;
        const red = redLineAt(editor.bm, t);
        const beats = (t - red.time) / red.beatLength;
        const p = ((beats % 2) + 2) % 2;
        el.style.left = `${(p / 2) * 100}%`;
      }),
    [],
  );
  const width = Math.min(100, (sv / 3.6) * 140);
  return (
    <div className="tm-slider" style={{ width: `${width}%` }}>
      <div className="tm-slider-track">
        <div className="tm-slider-path">
        {Array.from({ length: ticks + 1 }, (_, i) => <span key={i} className="tm-slider-tick" style={{ left: `${(i / ticks) * 100}%` }} />)}
        <div className="tm-slider-ball" ref={ball} />
        </div>
      </div>
    </div>
  );
}

/** Top right of the timing view: measure:beat readout and the metronome with Reset / Tap Here!. */
export function TimingTopRight() {
  const beatsRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onFrame((t) => {
        if (!editor.hasProject) return;
        const bm = editor.bm;
        const r = redLineAt(bm, t);
        const beat = Math.floor((t - r.time) / r.beatLength + 1e-6);
        const meter = r.meter || 4;
        const inBar = ((beat % meter) + meter) % meter;
        const bar = Math.floor(beat / meter);
        if (posRef.current) posRef.current.textContent = bm.timingPoints.some((x) => x.uninherited) ? `${bar}:${inBar + 1}` : '';
        const el = beatsRef.current;
        if (el) {
          const n = Math.min(meter, 8);
          [...el.children].forEach((c, i) => {
            const e = c as HTMLElement;
            e.style.display = i < n ? '' : 'none';
            e.className = `tm-beat ${i === inBar % n ? (inBar === 0 ? 'lit down' : 'lit') : ''}`;
          });
        }
      }),
    [],
  );
  return (
    <div className="tm-top">
      <div className="tm-pos" ref={posRef} />
      <div className="tm-metro">
        <button className="tm-reset" onClick={() => (taps.length = 0)}>Reset</button>
        <div className="tm-metro-right">
          <div className="tm-beats" ref={beatsRef}>
            {Array.from({ length: 8 }, (_, i) => <span key={i} className="tm-beat" />)}
          </div>
          <button className="tm-tap" onClick={tap}>Tap Here!</button>
        </div>
      </div>
    </div>
  );
}
