import { useMemo, useState } from 'react';
import { music } from '../../../audio/music';
import { fmt } from '../../../osu/info';
import { controlPointAt, snapTime, sortTimingPoints } from '../../../osu/timing';
import type { Beatmap, SampleSet, TimingPoint } from '../../../osu/types';
import { Check, GroupBox, NumberBox, OkCancel, Radio, Row, TrackRow, WinDialog, WinTabs } from '../../../ui/win';
import { DIVISORS } from '../../shortcuts';
import { formatTimestamp, shiftObjectTime, snapSliderLength, useEditor } from '../../store';

interface DraftPoint {
  key: number;
  /** Index in the beatmap's timing points when the window opened (null for points added here). */
  orig: number | null;
  tp: TimingPoint;
}

const LEFT_TABS = ['Timing', 'Audio', 'Style'] as const;
const LIST_TABS = ['All', 'Timing Points', 'Inherited Points'] as const;
const SAMPLE_LETTERS = ['', 'N', 'S', 'D'];

let nextKey = 1;

/** F6 Timing and Control Points: edit points on a copy, then apply with the options at the bottom. */
export function TimingSetupDialog() {
  const ed = useEditor();
  const bm = ed.bm;
  const [points, setPoints] = useState<DraftPoint[]>(() => bm.timingPoints.map((tp, i) => ({ key: nextKey++, orig: i, tp: { ...tp } })));
  const initialFocus = useMemo(() => {
    const cur = bm.timingPoints.indexOf(controlPointAt(bm, music.time));
    return points.find((p) => p.orig === cur)?.key ?? points[0]?.key ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialFocus !== null ? [initialFocus] : []));
  const [focus, setFocus] = useState<number | null>(initialFocus);
  const [leftTab, setLeftTab] = useState<(typeof LEFT_TABS)[number]>('Timing');
  const [listTab, setListTab] = useState<(typeof LIST_TABS)[number]>('All');
  const [inherit, setInherit] = useState(true);
  const [opts, setOpts] = useState({ scale: false, snap: false, resnapSliders: false, adjust: false, divisor: ed.beatDivisor });

  const sorted = useMemo(() => {
    const s = [...points].sort((a, b) => a.tp.time - b.tp.time || (a.tp.uninherited === b.tp.uninherited ? 0 : a.tp.uninherited ? -1 : 1));
    return s.filter((p) => listTab === 'All' || (listTab === 'Timing Points') === p.tp.uninherited);
  }, [points, listTab]);
  const focused = points.find((p) => p.key === focus) ?? null;
  const sel = points.filter((p) => selected.has(p.key));

  /** Apply a change to every selected point (that it makes sense for). */
  const edit = (fn: (tp: TimingPoint, p: DraftPoint) => void) => setPoints((ps) => ps.map((p) => (selected.has(p.key) ? { ...p, tp: (() => { const t = { ...p.tp }; fn(t, p); return t; })() } : p)));

  const click = (p: DraftPoint, e: React.MouseEvent) => {
    if (e.shiftKey && focus !== null) {
      const a = sorted.findIndex((x) => x.key === focus);
      const b = sorted.findIndex((x) => x.key === p.key);
      setSelected(new Set(sorted.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.key)));
    } else if (e.ctrlKey || e.metaKey) {
      const n = new Set(selected);
      if (n.has(p.key)) n.delete(p.key);
      else n.add(p.key);
      setSelected(n);
      setFocus(p.key);
    } else {
      setSelected(new Set([p.key]));
      setFocus(p.key);
      music.seek(p.tp.time);
    }
  };

  const add = () => {
    const t = Math.round(music.time);
    const reds = points.filter((p) => p.tp.uninherited);
    const red = !reds.length || listTab === 'Timing Points';
    const before = [...points].filter((p) => p.tp.time <= t).sort((a, b) => b.tp.time - a.tp.time)[0]?.tp;
    const lastRed = [...reds].filter((p) => p.tp.time <= t).sort((a, b) => b.tp.time - a.tp.time)[0]?.tp ?? reds[0]?.tp;
    const base = inherit && before ? before : null;
    const tp: TimingPoint = {
      time: t,
      beatLength: red ? lastRed?.beatLength ?? 500 : base && !base.uninherited ? base.beatLength : -100,
      meter: lastRed?.meter ?? 4,
      sampleSet: base?.sampleSet ?? 0,
      sampleIndex: base?.sampleIndex ?? 0,
      volume: base?.volume ?? 100,
      uninherited: red,
      kiai: base?.kiai ?? false,
      omitFirstBarLine: false,
    };
    const key = nextKey++;
    setPoints((ps) => [...ps.filter((p) => !(p.tp.time === t && p.tp.uninherited === red)), { key, orig: null, tp }]);
    setSelected(new Set([key]));
    setFocus(key);
  };

  const remove = () => {
    setPoints((ps) => ps.filter((p) => !selected.has(p.key)));
    setSelected(new Set());
    setFocus(null);
  };

  const apply = () => {
    const old = bm.timingPoints;
    const next = points.map((p) => p.tp);
    sortTimingPoints(next);
    // Old red line → its edited version, for keeping objects on their ticks.
    const pairs = points.filter((p) => p.orig !== null && old[p.orig].uninherited && p.tp.uninherited).map((p) => ({ from: old[p.orig!], to: p.tp })).sort((a, b) => a.from.time - b.from.time);
    const remap = (t: number) => {
      if (!pairs.length) return t;
      let pr = pairs[0];
      for (const x of pairs) if (x.from.time <= t + 0.5) pr = x;
      return Math.round(pr.to.time + ((t - pr.from.time) * pr.to.beatLength) / pr.from.beatLength);
    };
    const div = opts.divisor;
    ed.commit((b: Beatmap) => {
      b.timingPoints = next;
      if (opts.scale) {
        for (const o of b.hitObjects) {
          if (o.kind === 'spinner' || o.kind === 'hold') o.endTime = remap(o.endTime);
          o.time = remap(o.time);
        }
      }
      if (opts.adjust) {
        b.editor.bookmarks = b.editor.bookmarks.map(remap);
        if (b.general.previewTime >= 0) b.general.previewTime = remap(b.general.previewTime);
      }
      if (opts.snap) {
        for (const o of b.hitObjects) {
          shiftObjectTime(o, Math.round(snapTime(b, o.time, div)) - o.time);
          if (o.kind === 'spinner' || o.kind === 'hold') o.endTime = Math.round(snapTime(b, o.endTime, div));
        }
      }
      if (opts.resnapSliders) for (const o of b.hitObjects) if (o.kind === 'slider') snapSliderLength(b, o, div);
    });
    ed.openDialog(null);
  };

  const fp = focused?.tp;
  const sv = fp && !fp.uninherited ? Math.round((-100 / fp.beatLength) * 100) / 100 : 1;
  const preset = [0.75, 1, 1.5].find((v) => Math.abs(v - sv) < 0.001);

  return (
    <WinDialog title="Timing and Control Points" onClose={() => ed.openDialog(null)} width={720} footer={<OkCancel onOk={apply} onCancel={() => ed.openDialog(null)} />}>
      <div className="tsd">
        <div className="tsd-left">
          <WinTabs tabs={LEFT_TABS} value={leftTab} onChange={setLeftTab}>
            {!fp && <p className="win-muted">Select a timing point in the list, or add one with +.</p>}
            {fp && leftTab === 'Timing' && (
              <>
                <GroupBox title="General">
                  <Row label="Offset">
                    <NumberBox value={fp.time} step={1} width={110} onChange={(v) => { const delta = Math.round(v) - fp.time; edit((t) => (t.time += delta)); }} />
                  </Row>
                  <button className="tsd-wide" onClick={() => { const delta = Math.round(music.time) - fp.time; edit((t) => (t.time += delta)); }}>Use Current Time</button>
                </GroupBox>
                {fp.uninherited ? (
                  <GroupBox title="Timing">
                    <Row label="BPM"><NumberBox value={Number((60000 / fp.beatLength).toFixed(3))} min={1} step={1} width={110} onChange={(v) => v > 0 && edit((t) => t.uninherited && (t.beatLength = 60000 / v))} /></Row>
                    <Row label="Time Signature">
                      <select value={fp.meter} onChange={(e) => edit((t) => t.uninherited && (t.meter = Number(e.target.value)))}>
                        {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
                      </select>
                    </Row>
                  </GroupBox>
                ) : (
                  <GroupBox title="Difficulty">
                    <div><b>Slider velocity multiplier:</b></div>
                    <div>
                      {[0.75, 1, 1.5].map((v) => <Radio key={v} name="sv" label={`${fmt(v, 2)}x`} checked={preset === v} onChange={() => edit((t) => !t.uninherited && (t.beatLength = -100 / v))} />)}
                    </div>
                    <div className="tsd-custom">
                      <Radio name="sv" label="Custom:" checked={preset === undefined} onChange={() => undefined} />
                      <NumberBox value={sv} min={0.1} max={10} step={0.1} width={70} digits={2} onChange={(v) => edit((t) => !t.uninherited && (t.beatLength = -100 / v))} />
                    </div>
                  </GroupBox>
                )}
              </>
            )}
            {fp && leftTab === 'Audio' && (
              <>
                <GroupBox title="Sampleset">
                  <select value={fp.sampleSet} onChange={(e) => edit((t) => (t.sampleSet = Number(e.target.value) as SampleSet))}>
                    <option value={0}>Default (from Song Setup)</option>
                    <option value={1}>Normal</option>
                    <option value={2}>Soft</option>
                    <option value={3}>Drum</option>
                  </select>
                  <div className="tsd-custom">
                    <Check label="Custom overrides" checked={fp.sampleIndex > 0} onChange={(v) => edit((t) => (t.sampleIndex = v ? Math.max(1, t.sampleIndex) : 0))} />
                    <NumberBox value={fp.sampleIndex} min={0} step={1} width={60} disabled={fp.sampleIndex === 0} onChange={(v) => edit((t) => (t.sampleIndex = Math.round(v)))} />
                  </div>
                </GroupBox>
                <GroupBox title="Volume">
                  <TrackRow label="" value={fp.volume} min={5} max={100} step={1} onChange={(v) => edit((t) => (t.volume = Math.round(v)))} />
                </GroupBox>
              </>
            )}
            {fp && leftTab === 'Style' && (
              <GroupBox title="Style">
                <Check label="Kiai time" checked={fp.kiai} onChange={(v) => edit((t) => (t.kiai = v))} /><br />
                <Check label="Omit first bar line" checked={fp.omitFirstBarLine} disabled={!fp.uninherited} onChange={(v) => edit((t) => t.uninherited && (t.omitFirstBarLine = v))} />
              </GroupBox>
            )}
            {sel.length > 1 && <p className="win-muted">{sel.length} points selected: changes apply to all of them.</p>}
          </WinTabs>
        </div>
        <div className="tsd-right">
          <WinTabs tabs={LIST_TABS} value={listTab} onChange={setListTab}>
            <div className="win-list tsd-list">
              <table>
                <thead>
                  <tr><th>Offset</th><th>BPM</th><th>Meter</th><th>Sample</th><th>Vol.</th><th>Ki</th></tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.key} className={`${selected.has(p.key) ? 'sel' : ''} ${p.key === focus ? 'focus' : ''}`} onMouseDown={(e) => click(p, e)}>
                      <td><span className="win-dot" style={{ background: p.tp.uninherited ? '#e03030' : '#3aa53a' }} />{formatTimestamp(p.tp.time)}</td>
                      <td>{p.tp.uninherited ? fmt(60000 / p.tp.beatLength, 2) : `x${fmt(-100 / p.tp.beatLength, 2)}`}</td>
                      <td>{p.tp.uninherited ? p.tp.meter : ''}</td>
                      <td>{SAMPLE_LETTERS[p.tp.sampleSet]}{p.tp.sampleIndex > 0 ? `:${p.tp.sampleIndex}` : ''}</td>
                      <td>{p.tp.volume}%</td>
                      <td>{p.tp.kiai ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tsd-listbar">
              <Check label="Inherit previous timing settings" checked={inherit} onChange={setInherit} />
              <span className="tsd-addrm">
                <button className="tsd-icon add" onClick={add} title="Add a point at the current time">+</button>
                <button className="tsd-icon rm" onClick={remove} disabled={!selected.size} title="Delete the selected points">✕</button>
              </span>
            </div>
          </WinTabs>
        </div>
      </div>
      <div className="tsd-apply">
        <div>When applying timing changes...</div>
        <div className="tsd-apply-grid">
          <Check label="Scale objects to new timing" checked={opts.scale} onChange={(v) => setOpts({ ...opts, scale: v })} />
          <Check label="Resnap slider lengths" checked={opts.resnapSliders} onChange={(v) => setOpts({ ...opts, resnapSliders: v })} />
          <span className="tsd-divisor">
            Use beat snap divisor of{' '}
            <select value={opts.divisor} onChange={(e) => setOpts({ ...opts, divisor: Number(e.target.value) })}>
              {DIVISORS.map((d) => <option key={d} value={d}>1/{d}</option>)}
            </select>
          </span>
          <Check label="Snap objects to new timing" checked={opts.snap} onChange={(v) => setOpts({ ...opts, snap: v })} />
          <Check label="Adjust bookmarks and audio preview" checked={opts.adjust} onChange={(v) => setOpts({ ...opts, adjust: v })} />
        </div>
      </div>
    </WinDialog>
  );
}
