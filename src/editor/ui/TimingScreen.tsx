import { useEffect, useRef, useState } from 'react';
import { music } from '../../audio/music';
import { bpmOf, redLineAt } from '../../osu/timing';
import { onFrame } from '../playback';
import { editor, useEditor } from '../store';
import { TimingPointsTable } from './TimingPointsTable';

/** F3 timing mode: tap tempo, offset/BPM nudging, metronome and the full control point list. */
export function TimingScreen() {
  const ed = useEditor();
  const bm = ed.bm;
  const red = bm.timingPoints.some((t) => t.uninherited) ? redLineAt(bm, music.time) : null;
  const redIndex = red ? bm.timingPoints.indexOf(red) : -1;
  const taps = useRef<number[]>([]);
  const [tapInfo, setTapInfo] = useState('');
  const beatRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onFrame((t) => {
        const el = beatRef.current;
        if (!el || !editor.hasProject) return;
        const r = redLineAt(editor.bm, t);
        const beat = Math.floor((t - r.time) / r.beatLength);
        const inBar = ((beat % r.meter) + r.meter) % r.meter;
        const frac = ((t - r.time) / r.beatLength) - beat;
        [...el.children].forEach((c, i) => {
          (c as HTMLElement).style.opacity = i === inBar ? String(1 - frac * 0.7) : '0.15';
          (c as HTMLElement).style.display = i < r.meter ? '' : 'none';
        });
      }),
    [],
  );

  const tap = () => {
    const now = performance.now();
    const t = taps.current;
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0;
    t.push(now);
    if (t.length >= 2) {
      const bpm = (60000 * (t.length - 1)) / (t[t.length - 1] - t[0]) * music.rate;
      setTapInfo(`${bpm.toFixed(2)} BPM (${t.length} taps)`);
    } else setTapInfo('Keep tapping…');
  };

  const applyTap = () => {
    const t = taps.current;
    if (t.length < 4) return;
    const bpm = (60000 * (t.length - 1)) / (t[t.length - 1] - t[0]) * music.rate;
    const beatLength = (60000 * 100) / Math.round(bpm * 100);
    if (redIndex >= 0) ed.updateTimingPoint(redIndex, { beatLength });
    else {
      const tp = ed.addTimingPoint(true);
      ed.updateTimingPoint(ed.bm.timingPoints.indexOf(tp), { beatLength });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && !e.ctrlKey && !e.altKey && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const nudgeOffset = (ms: number) => red && ed.updateTimingPoint(redIndex, { time: red.time + ms });
  const nudgeBpm = (d: number) => red && ed.updateTimingPoint(redIndex, { beatLength: 60000 / Math.max(1, bpmOf(red) + d) });
  const mod = (e: React.MouseEvent, base: number, ctrlValue: number) => (e.ctrlKey ? ctrlValue : e.shiftKey ? base * 5 : base);

  return (
    <div className="timing-screen">
      <div className="timing-controls">
        <div className="metronome" ref={beatRef}>
          {Array.from({ length: 16 }, (_, i) => <div key={i} className={`beat ${i === 0 ? 'down' : ''}`} />)}
        </div>
        {red ? (
          <div className="timing-current">
            <div className="big-bpm">{bpmOf(red).toFixed(2)} <small>BPM</small></div>
            <div className="row">
              <span>BPM</span>
              <button onClick={(e) => nudgeBpm(-mod(e, 1, 0.25))}>−</button>
              <button onClick={(e) => nudgeBpm(mod(e, 1, 0.25))}>+</button>
              <span className="muted">Shift ×5 · Ctrl ±0.25</span>
            </div>
            <div className="row">
              <span>Offset {red.time}ms</span>
              <button onClick={(e) => nudgeOffset(-mod(e, 1, 1))}>−</button>
              <button onClick={(e) => nudgeOffset(mod(e, 1, 1))}>+</button>
              <button onClick={() => ed.updateTimingPoint(redIndex, { time: Math.round(music.time) })}>Use current time</button>
            </div>
            <div className="row">
              <span>Meter</span>
              <select value={red.meter} onChange={(e) => ed.updateTimingPoint(redIndex, { meter: Number(e.target.value) })}>
                {[2, 3, 4, 5, 6, 7].map((m) => <option key={m} value={m}>{m}/4</option>)}
              </select>
            </div>
          </div>
        ) : (
          <p>No timing yet. Play the song, then press <b>Ctrl+P</b> on the first downbeat (or tap below) to create a red line.</p>
        )}
        <div className="row">
          <button className="primary" onClick={tap}>Tap (T)</button>
          <span>{tapInfo}</span>
          <button onClick={applyTap} disabled={taps.current.length < 4}>Apply tapped BPM</button>
        </div>
        <div className="row">
          <label>
            <input type="checkbox" checked={ed.metronome} onChange={() => { ed.metronome = !ed.metronome; ed.emit(); }} /> Metronome during playback
          </label>
        </div>
      </div>
      <TimingPointsTable />
    </div>
  );
}
