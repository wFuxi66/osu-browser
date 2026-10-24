import { music } from '../../audio/music';
import { controlPointAt } from '../../osu/timing';
import { SAMPLE_SET_NAMES, type SampleSet, type TimingPoint } from '../../osu/types';
import { editor, formatTimestamp, useEditor } from '../store';

function NumCell({ value, onChange, step = 1, min, max, width = 70 }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number }) {
  return (
    <input
      type="number"
      style={{ width }}
      step={step}
      min={min}
      max={max}
      defaultValue={value}
      key={value}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== value) onChange(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function TimingPointsTable() {
  const ed = useEditor();
  const bm = ed.bm;
  const current = controlPointAt(bm, music.time);
  const update = (i: number, patch: Partial<TimingPoint>) => ed.updateTimingPoint(i, patch);
  return (
    <div className="tp-table-wrap">
      <div className="tp-actions">
        <button onClick={() => ed.addTimingPoint(true)}>+ Timing point (red)</button>
        <button onClick={() => ed.addTimingPoint(false)}>+ Inherited point (green)</button>
        <span className="muted">Times are in ms. Click a row's time to seek there.</span>
      </div>
      <table className="tp-table">
        <thead>
          <tr>
            <th>Time</th>
            <th></th>
            <th>BPM / SV</th>
            <th>Meter</th>
            <th>Sampleset</th>
            <th>Index</th>
            <th>Volume</th>
            <th>Kiai</th>
            <th title="Omit first bar line">Omit bar</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bm.timingPoints.map((tp, i) => (
            <tr key={`${i}-${tp.time}-${tp.uninherited}`} className={`${tp.uninherited ? 'red' : 'green'} ${tp === current ? 'current' : ''}`}>
              <td>
                <button className="link" onClick={() => music.seek(tp.time)} title={formatTimestamp(tp.time)}>
                  {formatTimestamp(tp.time)}
                </button>
                <NumCell value={tp.time} onChange={(v) => update(i, { time: Math.round(v) })} width={80} />
              </td>
              <td>
                <span className={`tp-kind ${tp.uninherited ? 'red' : 'green'}`}>{tp.uninherited ? 'Timing' : 'Inherited'}</span>
              </td>
              <td>
                {tp.uninherited ? (
                  <NumCell value={Number((60000 / tp.beatLength).toFixed(3))} step={0.01} min={1} onChange={(v) => v > 0 && update(i, { beatLength: 60000 / v })} />
                ) : (
                  <NumCell value={Number((-100 / tp.beatLength).toFixed(3))} step={0.05} min={0.1} max={10} onChange={(v) => v > 0 && update(i, { beatLength: -100 / v })} />
                )}
                <span className="unit">{tp.uninherited ? 'bpm' : 'x'}</span>
              </td>
              <td>{tp.uninherited ? <NumCell value={tp.meter} min={1} max={16} width={44} onChange={(v) => update(i, { meter: Math.max(1, Math.round(v)) })} /> : null}</td>
              <td>
                <select value={tp.sampleSet} onChange={(e) => update(i, { sampleSet: Number(e.target.value) as SampleSet })}>
                  {SAMPLE_SET_NAMES.map((n, k) => <option key={n} value={k}>{k === 0 ? 'default' : n}</option>)}
                </select>
              </td>
              <td><NumCell value={tp.sampleIndex} min={0} width={44} onChange={(v) => update(i, { sampleIndex: Math.max(0, Math.round(v)) })} /></td>
              <td><NumCell value={tp.volume} min={0} max={100} width={50} onChange={(v) => update(i, { volume: Math.max(0, Math.min(100, Math.round(v))) })} /></td>
              <td><input type="checkbox" checked={tp.kiai} onChange={(e) => update(i, { kiai: e.target.checked })} /></td>
              <td>{tp.uninherited ? <input type="checkbox" checked={tp.omitFirstBarLine} onChange={(e) => update(i, { omitFirstBarLine: e.target.checked })} /> : null}</td>
              <td>
                <button className="danger small" onClick={() => editor.commit((b) => b.timingPoints.splice(i, 1))}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bm.timingPoints.length === 0 && <p className="muted">No timing points yet. Seek to the first downbeat and add a red line, then set the BPM.</p>}
    </div>
  );
}
