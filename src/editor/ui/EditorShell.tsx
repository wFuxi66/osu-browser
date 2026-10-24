import { useEffect, useRef, useState } from 'react';
import { music } from '../../audio/music';
import { MODE_NAMES } from '../../osu/types';
import { onFrame } from '../playback';
import { editor, formatTimestamp, GRID_SIZES, useEditor, type Tool } from '../store';
import { stepDivisor } from '../shortcuts';
import { Dialogs } from './dialogs/Dialogs';
import { DesignScreen } from './DesignScreen';
import { MenuBar } from './MenuBar';
import { Playfield } from './Playfield';
import { SongProgress } from './SongProgress';
import { Timeline } from './Timeline';
import { TimingScreen } from './TimingScreen';
import { SAMPLE_SET_NAMES, type SampleSet } from '../../osu/types';
import { objectEndTime, sliderSpanDuration, svAt, bpmOf, redLineAt } from '../../osu/timing';

export function EditorShell() {
  const ed = useEditor();
  return (
    <div className="editor">
      <MenuBar />
      <div className="timeline-row">
        <ZoomControl />
        <Timeline />
        <DivisorControl />
      </div>
      <div className="editor-main">
        {ed.screen === 'compose' && (
          <>
            <Toolbox />
            <div className="playfield-wrap">
              <Playfield />
              <SelectionInfo />
            </div>
            <HitsoundPanel />
          </>
        )}
        {ed.screen === 'timing' && <TimingScreen />}
        {ed.screen === 'design' && <DesignScreen />}
      </div>
      <BottomBar />
      <Dialogs />
    </div>
  );
}

function ZoomControl() {
  const ed = useEditor();
  const z = ed.bm.editor.timelineZoom;
  const set = (v: number) => {
    ed.bm.editor.timelineZoom = Math.round(Math.max(0.1, Math.min(8, v)) * 100) / 100;
    ed.emit();
  };
  return (
    <div className="side-control">
      <span className="label">Zoom</span>
      <div className="row">
        <button onClick={() => set(z / 1.25)}>−</button>
        <span>{z.toFixed(1)}x</span>
        <button onClick={() => set(z * 1.25)}>+</button>
      </div>
    </div>
  );
}

function DivisorControl() {
  const ed = useEditor();
  return (
    <div className="side-control">
      <span className="label">Beat snap divisor</span>
      <div className="row">
        <button onClick={() => stepDivisor(-1)}>−</button>
        <span className="divisor">1/{ed.beatDivisor}</span>
        <button onClick={() => stepDivisor(1)}>+</button>
      </div>
    </div>
  );
}

const TOOL_LABELS: Record<Tool, string> = { select: 'Select', circle: 'Circle', slider: 'Slider', spinner: 'Spinner' };

function Toolbox() {
  const ed = useEditor();
  const mode = ed.bm.general.mode;
  const tools: Tool[] = mode === 3 ? ['select', 'circle', 'slider'] : ['select', 'circle', 'slider', 'spinner'];
  const label = (t: Tool) => (mode === 3 ? { select: 'Select', circle: 'Note', slider: 'Hold', spinner: '' }[t] : mode === 1 && t === 'slider' ? 'Drumroll' : mode === 1 && t === 'spinner' ? 'Denden' : mode === 2 && t === 'circle' ? 'Fruit' : mode === 2 && t === 'slider' ? 'Juice stream' : mode === 2 && t === 'spinner' ? 'Banana' : TOOL_LABELS[t]);
  return (
    <aside className="toolbox">
      <div className="panel-title">Toolbox</div>
      {tools.map((t, i) => (
        <button key={t} className={`tool ${ed.tool === t ? 'active' : ''}`} onClick={() => ed.setTool(t)} title={`${label(t)} (${i + 1})`}>
          <span className="key">{i + 1}</span> {label(t)}
        </button>
      ))}
      {(mode === 0 || mode === 2) && (
        <>
          <div className="panel-title">Snapping</div>
          {mode === 0 && <Toggle on={ed.gridSnap} onClick={() => { ed.gridSnap = !ed.gridSnap; ed.emit(); }} label="Grid snap" hint="T" />}
          <Toggle on={ed.distanceSnap} onClick={() => { ed.distanceSnap = !ed.distanceSnap; ed.emit(); }} label="Distance snap" hint="Y" />
          {mode === 0 && <div className="field">
            <span>Grid size</span>
            <select value={ed.gridSize} onChange={(e) => ed.setGridSize(Number(e.target.value))}>
              {GRID_SIZES.map((g) => (
                <option key={g} value={g}>{{ 4: 'Tiny', 8: 'Small', 16: 'Medium', 32: 'Large' }[g]} ({g})</option>
              ))}
            </select>
          </div>}
          <div className="field">
            <span>Distance spacing</span>
            <input type="number" step={0.1} min={0.1} max={6} value={ed.bm.editor.distanceSpacing} onChange={(e) => ed.setDistanceSpacing(Number(e.target.value))} />
          </div>
        </>
      )}
      <Toggle on={ed.locked} onClick={() => { ed.locked = !ed.locked; ed.emit(); }} label="Lock notes" hint="L" />
    </aside>
  );
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="dot" /> {label} {hint && <span className="key">{hint}</span>}
    </button>
  );
}

function HitsoundPanel() {
  const ed = useEditor();
  const s = ed.selectionHitsoundState();
  const setOpt = (which: 'normal' | 'addition', v: string) => ed.setSampleSet(which, Number(v) as SampleSet);
  const mode = ed.bm.general.mode;
  return (
    <aside className="hitsounds">
      <div className="panel-title">{ed.selectedEdge ? 'Slider edge' : ed.selection.size ? `Selection (${ed.selection.size})` : 'Placement'}</div>
      {mode !== 3 && <Toggle on={s.newCombo} onClick={() => ed.toggleNewCombo()} label="New combo" hint="Q" />}
      <div className="panel-title">Hitsounds</div>
      <Toggle on={s.whistle} onClick={() => ed.toggleAddition(2)} label={mode === 1 ? 'Whistle (kat)' : 'Whistle'} hint="W" />
      <Toggle on={s.finish} onClick={() => ed.toggleAddition(4)} label={mode === 1 ? 'Finish (big)' : 'Finish'} hint="E" />
      <Toggle on={s.clap} onClick={() => ed.toggleAddition(8)} label={mode === 1 ? 'Clap (kat)' : 'Clap'} hint="R" />
      <div className="field">
        <span>Sampleset</span>
        <select value={s.normalSet} onChange={(e) => setOpt('normal', e.target.value)}>
          {s.normalSet === (-1 as number) && <option value={-1}>(mixed)</option>}
          {SAMPLE_SET_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </div>
      <div className="field">
        <span>Additions</span>
        <select value={s.additionSet} onChange={(e) => setOpt('addition', e.target.value)}>
          {s.additionSet === (-1 as number) && <option value={-1}>(mixed)</option>}
          {SAMPLE_SET_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </div>
      {ed.selection.size > 0 && mode !== 3 && (
        <div className="field">
          <span>Colour skip</span>
          <input type="number" min={0} max={7} value={ed.selectedObjects[0]?.comboSkip ?? 0} onChange={(e) => ed.setComboSkip(Number(e.target.value))} />
        </div>
      )}
      <SampleVolume />
      <div className="mode-badge">{MODE_NAMES[mode]}</div>
    </aside>
  );
}

function SampleVolume() {
  const ed = useEditor();
  const sel = ed.selectedObjects;
  if (sel.length === 0) return null;
  const vol = sel.every((o) => o.sample.volume === sel[0].sample.volume) ? sel[0].sample.volume : -1;
  const idx = sel.every((o) => o.sample.index === sel[0].sample.index) ? sel[0].sample.index : -1;
  return (
    <>
      <div className="field">
        <span title="0 = use timing point">Volume</span>
        <input type="number" min={0} max={100} value={vol < 0 ? '' : vol} placeholder="mixed" onChange={(e) => ed.commit(() => sel.forEach((o) => (o.sample.volume = Math.max(0, Math.min(100, Number(e.target.value))))))} />
      </div>
      <div className="field">
        <span title="0 = use timing point">Custom index</span>
        <input type="number" min={0} value={idx < 0 ? '' : idx} placeholder="mixed" onChange={(e) => ed.commit(() => sel.forEach((o) => (o.sample.index = Math.max(0, Number(e.target.value)))))} />
      </div>
    </>
  );
}

/** Small overlay with details about the current selection, like stable's slider velocity readout. */
function SelectionInfo() {
  const ed = useEditor();
  const sel = ed.selectedObjects;
  if (sel.length === 0) return null;
  const bm = ed.bm;
  const o = sel[0];
  const lines: string[] = [];
  if (sel.length === 1) {
    lines.push(`${formatTimestamp(o.time)}  x:${Math.round(o.x)} y:${Math.round(o.y)}`);
    if (o.kind === 'slider') {
      const span = sliderSpanDuration(bm, o);
      lines.push(`${o.curveType === 'B' ? 'Bézier' : o.curveType === 'L' ? 'Linear' : o.curveType === 'P' ? 'Perfect curve' : 'Catmull'} · length ${o.length.toFixed(1)}px · ${o.slides - 1} repeat${o.slides === 2 ? '' : 's'}`);
      lines.push(`SV ${svAt(bm, o.time).toFixed(2)}x · ${(span / redLineAt(bm, o.time).beatLength).toFixed(2)} beats/span`);
    }
    if (o.kind === 'spinner' || o.kind === 'hold') lines.push(`duration ${Math.round(objectEndTime(bm, o) - o.time)}ms`);
  } else {
    const end = Math.max(...sel.map((x) => objectEndTime(bm, x)));
    lines.push(`${sel.length} objects · ${formatTimestamp(o.time)} – ${formatTimestamp(end)}`);
  }
  return (
    <div className="selection-info">
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>
  );
}

function TimeDisplay() {
  const ref = useRef<HTMLSpanElement>(null);
  const bpmRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(
    () =>
      onFrame((t) => {
        if (ref.current) ref.current.textContent = formatTimestamp(t);
        if (bpmRef.current && editor.hasProject) {
          const red = redLineAt(editor.bm, t);
          const sv = svAt(editor.bm, t);
          bpmRef.current.textContent = `${editor.bm.timingPoints.length ? bpmOf(red).toFixed(2) : '—'} BPM · ${sv.toFixed(2)}x · ${music.duration ? Math.floor((t / music.duration) * 100) : 0}%`;
        }
      }),
    [],
  );
  if (editing) {
    return (
      <input
        className="time-input"
        autoFocus
        defaultValue={formatTimestamp(music.time)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const m = /^(\d+):(\d+)(?::(\d+))?/.exec((e.target as HTMLInputElement).value.trim());
            if (m) music.seek(Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3] ?? 0));
            setEditing(false);
          } else if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="time-display" onClick={() => setEditing(true)} title="Click to jump to a time">
      <span ref={ref} className="time">00:00:000</span>
      <span ref={bpmRef} className="bpm" />
    </div>
  );
}

function BottomBar() {
  const ed = useEditor();
  const [, force] = useState(0);
  useEffect(() => music.onChange(() => force((n) => n + 1)), []);
  const rates = [0.25, 0.5, 0.75, 1];
  return (
    <div className="bottombar">
      <TimeDisplay />
      <div className="progress-wrap">
        <SongProgress />
      </div>
      <div className="transport">
        <button onClick={() => ed.seekFirstObject()} title="Jump to start (Z)">⏮</button>
        <button onClick={() => music.toggle()} title="Play/Pause (Space)">{music.playing ? '⏸' : '▶'}</button>
        <button onClick={() => music.stop()} title="Stop">⏹</button>
        <button onClick={() => ed.seekLastObject()} title="Jump to end (V)">⏭</button>
      </div>
      <div className="rates">
        {rates.map((r) => (
          <button key={r} className={Math.abs(music.rate - r) < 0.001 ? 'active' : ''} onClick={() => ed.setPlaybackRate(r)}>
            {r * 100}%
          </button>
        ))}
        {!rates.some((r) => Math.abs(music.rate - r) < 0.001) && <span className="rate-custom">{Math.round(music.rate * 100)}%</span>}
      </div>
    </div>
  );
}
