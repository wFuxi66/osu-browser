import { useEffect, useRef, useState, type ReactNode } from 'react';
import { music } from '../../audio/music';
import { sliderEndPosition } from '../../osu/curves';
import { fmt } from '../../osu/info';
import { objectEndTime } from '../../osu/timing';
import { SAMPLE_SET_NAMES, type HitObject, type SampleSet, type Vec2 } from '../../osu/types';
import { breakAt } from '../breaks';
import { onFrame } from '../playback';
import { expectedDistance } from '../playfield/snapping';
import { DIVISORS } from '../shortcuts';
import { editor, formatTimestamp, useEditor, type Tool } from '../store';
import { Dialogs } from './dialogs/Dialogs';
import { DesignScreen, DesignTimeline, DesignTopRight } from './DesignScreen';
import {
  CircleIcon, ClapIcon, DistanceSnapIcon, FinishIcon, GridSnapIcon, LockIcon, MinusIcon, NewComboIcon, PauseIcon,
  PlayIcon, PlusIcon, SelectIcon, SliderIcon, SpinnerIcon, StopIcon, TestIcon, WhistleIcon,
} from './icons';
import { MenuBar } from './MenuBar';
import { activePlayfield, Playfield } from './Playfield';
import { SongProgress } from './SongProgress';
import { Timeline } from './Timeline';
import { TouchBar } from './TouchBar';
import { TimingScreen, TimingTopRight } from './TimingScreen';
import { StageBackground } from './StageBackground';
import { shortcutOf } from '../keybinds';
import { useTouch } from '../../ui/touch';

/** The stable editor layout: menu strip, then a full-window stage with the panels laid over the playfield. */
export function EditorShell() {
  const ed = useEditor();
  return (
    <div className="ed">
      <MenuBar />
      <div className={`ed-stage screen-${ed.screen}`}>
        {ed.screen === 'compose' && <Playfield />}
        {ed.screen === 'timing' && <StageBackground />}
        {ed.screen === 'timing' && <TimingScreen />}
        {ed.screen === 'design' && <DesignScreen />}
        <TopPanel />
        {ed.screen === 'compose' && (
          <>
            <ComposeLeft />
            <ComposeRight />
            <TouchBar />
          </>
        )}
        {ed.screen !== 'design' && <Tip />}
        <BottomBar />
      </div>
      <Dialogs />
    </div>
  );
}

// ------------------------------------------------------------------ top panel

function TopPanel() {
  const ed = useEditor();
  return (
    <div className="ed-top">
      <ScreenTabs />
      <ZoomButtons />
      <div className="ed-timeline">{ed.screen === 'design' ? <DesignTimeline /> : <Timeline />}</div>
      <div className="ed-top-right">
        {ed.screen === 'compose' && <ComposeTopRight />}
        {ed.screen === 'timing' && <TimingTopRight />}
        {ed.screen === 'design' && <DesignTopRight />}
      </div>
    </div>
  );
}

function ScreenTabs() {
  const ed = useEditor();
  const tab = (label: string, active: boolean, onClick: () => void) => (
    <button className={active ? 'active' : ''} onClick={onClick}>{label}</button>
  );
  return (
    <div className="ed-tabs">
      {tab('compose', ed.screen === 'compose', () => ed.setScreen('compose'))}
      {tab('design', ed.screen === 'design', () => ed.setScreen('design'))}
      {tab('timing', ed.screen === 'timing', () => ed.setScreen('timing'))}
      {tab('song setup', ed.dialog === 'setup', () => ed.openDialog('setup'))}
    </div>
  );
}

function ZoomButtons() {
  const ed = useEditor();
  const set = (v: number) => ed.setTimelineZoom(v);
  const z = ed.hasProject ? ed.bm.editor.timelineZoom : 1;
  return (
    <div className="ed-zoom">
      <button onClick={() => set(z * 1.25)} title="Zoom in (Alt + wheel on the timeline)"><PlusIcon /></button>
      <button onClick={() => set(z / 1.25)} title="Zoom out"><MinusIcon /></button>
    </div>
  );
}

function ComposeTopRight() {
  const ed = useEditor();
  const insertBreak = () => {
    const br = breakAt(ed.bm, music.time);
    if (!br) return ed.toast('There is no room for a break here.', 'error');
    ed.commit((b) => {
      b.events.breaks = b.events.breaks.filter((x) => x.end < br.start || x.start > br.end);
      b.events.breaks.push(br);
      b.events.breaks.sort((x, y) => x.start - y.start);
    });
  };
  return (
    <>
      <BeatSnapDivisor />
      <button className="ed-insert-break" onClick={insertBreak}>Insert Break Time</button>
      <PositionReadout />
    </>
  );
}

/** "Beat Snap Divisor:" slider with stable's 1/1 … 1/16 stops. */
function BeatSnapDivisor() {
  const ed = useEditor();
  const track = useRef<HTMLDivElement>(null);
  const i = Math.max(0, DIVISORS.indexOf(ed.beatDivisor));
  const setFrom = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    ed.setBeatDivisor(DIVISORS[Math.round(f * (DIVISORS.length - 1))]);
  };
  return (
    <div className="ed-divisor">
      <div className="ed-divisor-label">Beat Snap Divisor:</div>
      <div
        className="ed-divisor-track"
        ref={track}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e) => e.buttons & 1 && setFrom(e.clientX)}
        data-wheel="divisor"
      >
        <div className="ed-divisor-fill" style={{ width: `${(i / (DIVISORS.length - 1)) * 100}%` }} />
        <div className="ed-divisor-knob" style={{ left: `${(i / (DIVISORS.length - 1)) * 100}%` }} />
      </div>
      <div className="ed-divisor-value">1/{ed.beatDivisor}</div>
    </div>
  );
}

function objectEnd(o: HitObject): Vec2 {
  return o.kind === 'slider' ? sliderEndPosition(o) : { x: o.x, y: o.y };
}

/** Top-right readout: cursor or selection position, plus distance snap ratios to the neighbours. */
function PositionReadout() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onFrame(() => {
        const el = ref.current;
        if (!el || !editor.hasProject) return;
        const sel = editor.selectedObjects;
        const lines: string[] = [];
        const bm = editor.bm;
        if (sel.length === 1 && sel[0].kind !== 'spinner' && bm.general.mode === 0) {
          const o = sel[0];
          lines.push(`x:${Math.round(o.x)} y:${Math.round(o.y)}`);
          const objs = bm.hitObjects.filter((x) => x.kind !== 'spinner');
          const idx = objs.indexOf(o);
          const ratio = (a: HitObject, b: HitObject) => {
            const from = objectEnd(a);
            const ds = bm.editor.distanceSpacing || 1;
            const expected = expectedDistance(objectEndTime(bm, a), b.time) / ds;
            return expected > 0 ? Math.hypot(b.x - from.x, b.y - from.y) / expected : 0;
          };
          if (idx > 0) lines.push(`Prev: ${fmt(ratio(objs[idx - 1], o), 2)}x`);
          if (idx >= 0 && idx < objs.length - 1) lines.push(`Next: ${fmt(ratio(o, objs[idx + 1]), 2)}x`);
          el.classList.add('selected');
        } else {
          const c = activePlayfield.current?.cursor;
          lines.push(c ? `x:${Math.round(c.x)} y:${Math.round(c.y)}` : '');
          el.classList.remove('selected');
        }
        const text = lines.join('\n');
        if (el.textContent !== text) el.textContent = text;
      }),
    [],
  );
  return <div className="ed-position" ref={ref} />;
}

// ------------------------------------------------------------------ compose side panels

const TOOL_ICONS: Record<Tool, () => ReactNode> = { select: SelectIcon, circle: CircleIcon, slider: SliderIcon, spinner: SpinnerIcon };

function toolLabel(mode: number, t: Tool): string {
  if (mode === 3) return { select: 'Select', circle: 'Note', slider: 'Hold', spinner: '' }[t];
  if (mode === 2) return { select: 'Select', circle: 'Fruit', slider: 'Juice Stream', spinner: 'Banana Shower' }[t];
  return { select: 'Select', circle: 'Circle', slider: 'Slider', spinner: 'Spinner' }[t];
}

function SampleDropdown({ label, value, onChange }: { label: string; value: number; onChange: (v: SampleSet) => void }) {
  return (
    <div className="ed-sample">
      <div className="ed-sample-label">{label}</div>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) as SampleSet)}>
        {value === -1 && <option value={-1}>(mixed)</option>}
        {SAMPLE_SET_NAMES.map((n, i) => <option key={n} value={i}>{n[0].toUpperCase() + n.slice(1)}</option>)}
      </select>
    </div>
  );
}

function ComposeLeft() {
  const ed = useEditor();
  const mode = ed.bm.general.mode;
  const tools: Tool[] = mode === 3 ? ['select', 'circle', 'slider'] : ['select', 'circle', 'slider', 'spinner'];
  const s = ed.selectionHitsoundState();
  return (
    <div className="ed-left">
      <SampleDropdown label="Sampleset" value={s.normalSet} onChange={(v) => ed.setSampleSet('normal', v)} />
      <SampleDropdown label="Additions" value={s.additionSet} onChange={(v) => ed.setSampleSet('addition', v)} />
      <div className="ed-tools">
        {tools.map((t, i) => {
          const Icon = TOOL_ICONS[t];
          return (
            <button key={t} className={`ed-tool ${ed.tool === t ? 'active' : ''}`} onClick={() => ed.setTool(t)} title={`${toolLabel(mode, t)} (${i + 1})`}>
              <Icon />
              <span>{toolLabel(mode, t)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, top, bottom, icon, title }: { on: boolean; onClick: () => void; top: string; bottom?: string; icon: ReactNode; title: string }) {
  return (
    <button className={`ed-toggle ${on ? 'on' : ''} ${bottom ? 'two' : 'one'}`} onClick={onClick} title={title}>
      {bottom && <span>{top}</span>}
      {icon}
      <span>{bottom ?? top}</span>
    </button>
  );
}

function ComposeRight() {
  const ed = useEditor();
  const s = ed.selectionHitsoundState();
  const mode = ed.bm.general.mode;
  // No hover tooltips on a phone: the distance snap button shows its spacing instead of "Snap".
  const touch = useTouch();
  return (
    <div className="ed-right">
      {mode !== 3 && <Toggle on={s.newCombo} onClick={() => ed.toggleNewCombo()} top="New" bottom="Combo" icon={<NewComboIcon />} title="New Combo (Q)" />}
      <Toggle on={s.whistle} onClick={() => ed.toggleAddition(2)} top="Whistle" icon={<WhistleIcon />} title="Whistle (W)" />
      <Toggle on={s.finish} onClick={() => ed.toggleAddition(4)} top="Finish" icon={<FinishIcon />} title="Finish (E)" />
      <Toggle on={s.clap} onClick={() => ed.toggleAddition(8)} top="Clap" icon={<ClapIcon />} title="Clap (R)" />
      {mode === 0 && <Toggle on={ed.gridSnap} onClick={() => { ed.gridSnap = !ed.gridSnap; ed.emit(); }} top="Grid" bottom="Snap" icon={<GridSnapIcon />} title="Grid Snap (T, hold Shift to toggle)" />}
      {(mode === 0 || mode === 2) && <Toggle on={ed.distanceSnap} onClick={() => { ed.distanceSnap = !ed.distanceSnap; ed.emit(); }} top="Distance" bottom={touch ? `${fmt(ed.bm.editor.distanceSpacing, 2)}x` : 'Snap'} icon={<DistanceSnapIcon />} title={`Distance Snap (Y, hold Alt to toggle) · ${fmt(ed.bm.editor.distanceSpacing, 2)}x (Alt + wheel)`} />}
      <Toggle on={ed.locked} onClick={() => { ed.locked = !ed.locked; ed.emit(); }} top="Lock" bottom="Notes" icon={<LockIcon />} title="Lock Notes (L)" />
    </div>
  );
}

// ------------------------------------------------------------------ tips

const TIPS = [
  'Esc goes back to song select. If you have unsaved changes, you are asked whether to save them first.',
  'Nothing saves automatically: press Ctrl+S to save. If you are logged in, saving also syncs the map to your account.',
  'When copying objects (Ctrl+C), the clipboard will contain the current time location and combo numbers of selected objects. This is especially useful for writing map feedback!',
  'Distance snap is a handy tool for precise spacing calculations. Hold the “Alt” key to fine-tune it.',
  'Try synchronizing the most important sounds in a song to clicks in gameplay. This is especially important when deciding slider rhythms!',
  'Hold Shift to toggle grid snap and Alt to toggle distance snap while you place or drag objects.',
  'Alt + mouse wheel changes the distance spacing over the playfield, and zooms when the cursor is over the timeline.',
  'Ctrl + mouse wheel changes the beat snap divisor. Shift + 1 to 9 sets it directly.',
  'Double click an object in the timeline (or a slider end on the playfield) to jump to it.',
  'Click an edge of a selected slider in the timeline to give that edge its own hitsounds.',
  'F5 tests the map from the current time. F6 opens Timing Setup.',
  'Drag the end of a slider in the timeline to add or remove repeats.',
];

function Tip() {
  const [i, setI] = useState(() => Math.floor(Math.random() * TIPS.length));
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % TIPS.length), 20000);
    return () => clearInterval(t);
  }, []);
  return <div className="ed-tip" key={i}>{TIPS[i]}</div>;
}

// ------------------------------------------------------------------ bottom bar

const PERCENT = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function TimeDisplay() {
  const ref = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(
    () =>
      onFrame((t) => {
        if (ref.current) ref.current.textContent = formatTimestamp(t);
        if (pctRef.current) {
          const d = music.duration;
          const pct = !d ? '' : t < 0 ? 'intro' : t > d ? 'outro' : `${PERCENT.format((t / d) * 100)}%`;
          if (pctRef.current.textContent !== pct) pctRef.current.textContent = pct;
        }
      }),
    [],
  );
  if (editing) {
    return (
      <input
        className="ed-time-input"
        autoFocus
        placeholder="00:00:000 (1,2,3) -"
        defaultValue={formatTimestamp(music.time)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            jumpToTimestamp((e.target as HTMLInputElement).value);
            setEditing(false);
          } else if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="ed-time" onClick={() => setEditing(true)} title="Click to go to a time, or paste a timestamp like 00:12:345 (1,2,3) -">
      <span ref={ref} className="ed-time-value">00:00:000</span>
      <span ref={pctRef} className="ed-time-pct" />
    </div>
  );
}

/** Go to a pasted modding timestamp and select the objects it names, like stable's timestamp box. */
export function jumpToTimestamp(text: string) {
  const m = /(\d+):(\d{1,2})(?:[:.](\d{1,3}))?\s*(?:\(([^)]*)\))?/.exec(text.trim());
  if (!m) return;
  const t = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] ?? '0').padEnd(3, '0'));
  music.seek(t);
  if (!m[4]) return;
  const bm = editor.bm;
  const ids: number[] = [];
  if (bm.general.mode === 3) {
    for (const part of m[4].split(',')) {
      const [time, col] = part.split('|').map(Number);
      const o = bm.hitObjects.find((x) => Math.abs(x.time - time) < 2 && editor.objectLabel(x).endsWith(`|${col}`));
      if (o) ids.push(o.id);
    }
  } else {
    const wanted = m[4].split(',').map((s) => s.trim());
    const after = bm.hitObjects.filter((o) => o.time >= t - 1);
    let k = 0;
    for (const o of after) {
      if (k >= wanted.length) break;
      if (editor.objectLabel(o) === wanted[k]) {
        ids.push(o.id);
        k++;
      }
    }
  }
  if (ids.length) {
    editor.setTool('select');
    editor.select(ids);
  }
}

function BottomBar() {
  const ed = useEditor();
  const [, force] = useState(0);
  useEffect(() => music.onChange(() => force((n) => n + 1)), []);
  const rates = [0.25, 0.5, 0.75, 1];
  return (
    <div className="ed-bottom">
      <TimeDisplay />
      <div className="ed-progress">
        <SongProgress />
      </div>
      <div className="ed-transport">
        <button onClick={() => void music.play()} title="Play (X)" className={music.playing ? 'lit' : ''}><PlayIcon /></button>
        <button onClick={() => music.pause()} title="Pause (C / Space)"><PauseIcon /></button>
        <button onClick={() => music.stop()} title="Stop"><StopIcon /></button>
        <button className="ed-test" onClick={() => { music.pause(); ed.openDialog('test'); }} title={`Test (${shortcutOf('test', ed.prefs.keybinds)})`}><TestIcon /> Test</button>
      </div>
      <div className="ed-rate">
        <span className="ed-rate-label">Playback Rate</span>
        {rates.map((r) => (
          <button key={r} className={Math.abs(music.rate - r) < 0.001 ? 'active' : ''} onClick={() => ed.setPlaybackRate(r)}>
            {r * 100}%
          </button>
        ))}
        {!rates.some((r) => Math.abs(music.rate - r) < 0.001) && <span className="ed-rate-custom">{Math.round(music.rate * 100)}%</span>}
      </div>
    </div>
  );
}
