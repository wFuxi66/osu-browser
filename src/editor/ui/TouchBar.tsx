import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { music } from '../../audio/music';
import { beatLengthAt, redLineAt } from '../../osu/timing';
import { onFrame } from '../playback';
import { runAction } from '../shortcuts';
import { editor, useEditor } from '../store';
import { touchMods, useTouch, useTouchMods, type TouchMods } from '../../ui/touch';
import { PauseIcon, PlayIcon } from './icons';
import { nodeMenu } from '../playfield/stdPlayfield';
import { activePlayfield } from './Playfield';

// Phone layout: time controls under the left thumb (play/pause and a jog strip), editing actions under the right
// one, in a short bar whose buttons change with what is being done (placing, a selection, nothing).

/** Strip pixels per beat-snap tick: one tick per notch of the strip. */
const TICK_PX = 16;
/** Fling momentum decay per millisecond, and the speed (px/ms) below which it stops. */
const FRICTION = 0.995;
const MIN_FLING = 0.05;

export function TouchBar() {
  const touch = useTouch();
  if (!touch) return null;
  return (
    <>
      <div className="ed-thumb-left">
        <AutoAdvance />
        <LoopButton />
        <JogStrip />
        <PlayButton />
      </div>
      <ContextBar />
      <NodeMenuPopup />
    </>
  );
}

function PlayButton() {
  const [playing, setPlaying] = useState(music.playing);
  useEffect(() => music.onChange(() => setPlaying(music.playing)), []);
  return (
    <button className="ed-thumb-play" onClick={() => runAction('pause')} title={playing ? 'Pause' : 'Play'}>
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}

const ADVANCE_STEPS = [0, 1, 2, 4];

/** Cycles how many ticks placing a circle moves time forward (see Playfield). */
function AutoAdvance() {
  const ed = useEditor();
  const n = ed.prefs.touchAutoAdvance;
  const next = () => ed.setPrefs({ touchAutoAdvance: ADVANCE_STEPS[(ADVANCE_STEPS.indexOf(n) + 1) % ADVANCE_STEPS.length] });
  return (
    <button className={`ed-thumb-advance ${n ? 'on' : ''}`} onClick={next} title="Move forward after placing a circle">
      {n ? `+${n}` : 'Auto'}
      <small>{n ? (n === 1 ? 'tick' : 'ticks') : 'off'}</small>
    </button>
  );
}

/** A–B loop: first tap marks A at the current time, the second marks B and starts looping, the third clears. */
function LoopButton() {
  const [loop, setLoop] = useState<{ a: number; b: number | null } | null>(null);
  useEffect(() => {
    if (loop?.b == null) return;
    const { a, b } = loop;
    return onFrame((t) => {
      if (music.playing && t >= b) music.seek(a);
    });
  }, [loop]);
  // A loop belongs to one difficulty's timeline position; drop it when the map changes.
  const project = useEditor().project;
  useEffect(() => setLoop(null), [project]);
  const tap = () => {
    const t = Math.round(editor.snap(music.time));
    if (!loop) setLoop({ a: t, b: null });
    else if (loop.b === null) {
      if (t !== loop.a) setLoop(t > loop.a ? { a: loop.a, b: t } : { a: t, b: loop.a });
    } else setLoop(null);
  };
  return (
    <button className={`ed-thumb-advance ${loop ? 'on' : ''}`} onClick={tap} title="Loop a section">
      {!loop ? 'Loop' : loop.b === null ? 'A →' : 'A–B'}
      <small>{!loop ? 'off' : loop.b === null ? 'set B' : 'clear'}</small>
    </button>
  );
}

/** A buzz for each tick the jog strip passes: stronger on beats, strongest on the first beat of a measure. */
function buzz(t: number) {
  const red = redLineAt(editor.bm, t);
  const beats = (t - red.time) / red.beatLength;
  const beat = Math.round(beats);
  if (Math.abs(beats - beat) > 0.01) navigator.vibrate?.(6);
  else navigator.vibrate?.(beat % Math.max(1, red.meter) === 0 ? 30 : 15);
}

/**
 * Vertical jog strip: dragging up moves forward in time one beat-snap tick per notch (like the arrow keys), a fling
 * keeps going and slows down, and a tap on the top or bottom half steps one tick.
 */
function JogStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; acc: number; moved: boolean; v: number; lastT: number } | null>(null);
  const fling = useRef(0);

  // The notches scroll with the song, so the strip shows where time is going.
  useEffect(
    () =>
      onFrame((t) => {
        const el = ref.current;
        if (!el || !editor.hasProject) return;
        const tick = beatLengthAt(editor.bm, t) / editor.beatDivisor;
        el.style.backgroundPositionY = `${((t / tick) * TICK_PX) % TICK_PX}px`;
      }),
    [],
  );
  useEffect(() => () => cancelAnimationFrame(fling.current), []);

  const step = (d: { acc: number }) => {
    while (Math.abs(d.acc) >= TICK_PX) {
      const dir = d.acc > 0 ? 1 : -1;
      editor.seekTick(dir);
      d.acc -= dir * TICK_PX;
      buzz(music.time);
    }
  };

  const down = (e: ReactPointerEvent) => {
    if (!editor.hasProject) return;
    cancelAnimationFrame(fling.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, y: e.clientY, acc: 0, moved: false, v: 0, lastT: performance.now() };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = d.y - e.clientY; // up = forward
    const now = performance.now();
    if (Math.abs(dy) > 0) {
      const dt = Math.max(1, now - d.lastT);
      d.v = d.v * 0.6 + (dy / dt) * 0.4;
      d.lastT = now;
    }
    d.y = e.clientY;
    d.acc += dy;
    if (Math.abs(d.acc) > 6) d.moved = true;
    step(d);
  };
  const up = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      const r = e.currentTarget.getBoundingClientRect();
      editor.seekTick(e.clientY < r.top + r.height / 2 ? 1 : -1);
      buzz(music.time);
      return;
    }
    // Lifted while still moving: keep stepping with decaying speed.
    if (performance.now() - d.lastT > 80 || Math.abs(d.v) < MIN_FLING * 4) return;
    const f = { acc: d.acc, v: d.v, t: performance.now() };
    const tick = (now: number) => {
      const dt = now - f.t;
      f.t = now;
      f.acc += f.v * dt;
      f.v *= FRICTION ** dt;
      step(f);
      if (Math.abs(f.v) >= MIN_FLING) fling.current = requestAnimationFrame(tick);
    };
    fling.current = requestAnimationFrame(tick);
  };

  return (
    <div
      ref={ref}
      className="ed-jog"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => (drag.current = null)}
    >
      <span className="ed-jog-arrow">▲</span>
      <span className="ed-jog-arrow">▼</span>
    </div>
  );
}

const SELECTION_MORE: [string, string][] = [
  ['cut', 'Cut'],
  ['reverse', 'Reverse'],
  ['clone', 'Clone'],
  ['rotateCw', 'Rot +90°'],
  ['rotateCcw', 'Rot −90°'],
  ['rotateBy', 'Rotate…'],
  ['scaleBy', 'Scale…'],
  ['stream', 'Stream…'],
  ['newCombo', 'New combo'],
];

const IDLE_MORE: [string, string][] = [
  ['polygon', 'Polygon…'],
  ['addBookmark', '+ Bookmark'],
  ['removeBookmark', '− Bookmark'],
  ['seekFirst', '⏮ First'],
  ['seekLast', 'Last ⏭'],
];

const MODS: [keyof TouchMods, string][] = [
  ['shift', 'Shift'],
  ['ctrl', 'Ctrl'],
  ['alt', 'Alt'],
];

type Btn = { label: string; run: () => void; disabled?: boolean; accent?: boolean; danger?: boolean };

/** A few large buttons for what makes sense right now, plus "…" for the rest. */
function ContextBar() {
  const ed = useEditor();
  const mods = useTouchMods();
  const [more, setMore] = useState(false);
  const act = (a: string) => () => runAction(a);
  const hasSel = ed.hasProject && ed.selection.size > 0;

  // The "…" sheet belongs to the state it was opened in.
  const mode = ed.placing ? 'placing' : hasSel ? 'selection' : 'idle';
  useEffect(() => setMore(false), [mode]);

  let buttons: Btn[];
  let extra: [string, string][] = [];
  if (ed.placing) {
    buttons = [
      {
        label: 'Finish',
        accent: true,
        run: () => (ed.placing?.kind === 'spinner' ? ed.spinnerClick() : runAction('finishPlacing')),
      },
      { label: 'Cancel', run: () => activePlayfield.current?.cancel() },
      { label: 'Undo', run: act('undo'), disabled: !ed.canUndo },
    ];
  } else if (hasSel) {
    buttons = [
      { label: 'Copy', run: act('copy') },
      { label: 'Flip H', run: act('flipH') },
      { label: 'Flip V', run: act('flipV') },
      { label: 'Delete', run: act('delete'), danger: true },
      { label: 'Deselect', run: () => ed.clearSelection() },
    ];
    const sel = ed.selectedObjects;
    if (sel.length === 1 && sel[0].kind === 'slider') {
      buttons.push({ label: 'Len −', run: () => ed.nudgeSliderLength(-1) }, { label: 'Len +', run: () => ed.nudgeSliderLength(1) });
    }
    extra = SELECTION_MORE;
  } else {
    buttons = [
      { label: 'Undo', run: act('undo'), disabled: !ed.canUndo },
      { label: 'Redo', run: act('redo'), disabled: !ed.canRedo },
      { label: 'Paste', run: act('paste'), disabled: !ed.canPaste },
      { label: 'Select all', run: act('selectAll') },
    ];
    extra = IDLE_MORE;
  }

  return (
    <div className="ed-ctx">
      {more && (
        <div className="ed-ctx-more">
          {extra.map(([a, l]) => (
            <button
              key={a}
              onClick={() => {
                runAction(a);
                setMore(false);
              }}
            >
              {l}
            </button>
          ))}
          <div className="ed-ctx-mods">
            {MODS.map(([k, l]) => (
              <button key={k} className={mods[k] ? 'on' : ''} onClick={() => touchMods.toggle(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={`ed-ctx-bar ${buttons.length > 4 ? 'two' : ''}`}>
        {buttons.map((b) => (
          <button
            key={b.label}
            className={b.accent ? 'accent' : b.danger ? 'danger' : ''}
            disabled={b.disabled}
            onClick={b.run}
          >
            {b.label}
          </button>
        ))}
        {mode !== 'placing' && (
          <button className={more || mods.shift || mods.ctrl || mods.alt ? 'on' : ''} onClick={() => setMore(!more)}>
            …
          </button>
        )}
      </div>
    </div>
  );
}

/** Red/white and delete for the slider control point just tapped (see StdPlayfield.openNodeMenu). */
function NodeMenuPopup() {
  const ed = useEditor();
  const m = nodeMenu.current;
  if (!m || ed.tool !== 'select' || !ed.selection.has(m.sliderId)) return null;
  return (
    <div className="ed-node-menu" style={{ left: m.x, top: m.y }}>
      <button onClick={m.toggleRed}>{m.red ? 'Make white' : 'Make red'}</button>
      {m.canDelete && (
        <button className="danger" onClick={m.remove}>
          Delete node
        </button>
      )}
    </div>
  );
}
