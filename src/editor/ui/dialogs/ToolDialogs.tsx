import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { hitsounds } from '../../../audio/hitsounds';
import { music } from '../../../audio/music';
import { sliderPositionAtSpan } from '../../../osu/curves';
import { parseOsu } from '../../../osu/parser';
import { serializeBeatmap } from '../../../osu/serializer';
import { beatLengthAt, sliderSpanDuration } from '../../../osu/timing';
import { defaultSample, newObjectId, type HitObject, type Slider } from '../../../osu/types';
import { filesFromDrop, pickFiles } from '../../../project/open';
import { downloadBlob, mimeFor, osuFilename, oszFilename } from '../../../project/project';
import { confirmBox } from '../../../ui/prompt';
import { Check, GroupBox, NumberBox, OkCancel, Radio, Row, TrackRow, WinDialog } from '../../../ui/win';
import { expectedDistance } from '../../playfield/snapping';
import { DIVISORS } from '../../shortcuts';
import { storyboard } from '../../storyboard/runtime';
import { design } from '../../storyboard/design';
import { applyCompletion, applyMerge, planCompletion, planMerge, type CompletionOptions, type FreeVariable, type MergeOptions } from '../../sliderTools';
import { editor, formatTimestamp, useEditor } from '../../store';

/**
 * Live preview for transform dialogs: the selection is restored and re-transformed on every change, applied
 * as one undo step on OK and rolled back on Cancel.
 */
function useLivePreview(applyFn: () => void, deps: unknown[]) {
  const originals = useRef<Map<number, HitObject> | null>(null);
  useEffect(() => {
    originals.current = new Map(editor.selectedObjects.map((o) => [o.id, structuredClone(o)]));
    editor.beginChange();
    return () => editor.cancelChange();
  }, []);
  useEffect(() => {
    const orig = originals.current;
    if (!orig) return;
    for (const o of editor.selectedObjects) {
      const src = orig.get(o.id);
      if (src) Object.assign(o, structuredClone(src));
    }
    applyFn();
    editor.touch();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    ok: () => {
      editor.endChange();
      editor.openDialog(null);
    },
    cancel: () => editor.openDialog(null),
  };
}

export function RotateDialog() {
  const ed = useEditor();
  const [angle, setAngle] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [pivot, setPivot] = useState<'playfield' | 'selection'>('playfield');
  const live = useLivePreview(() => angle && ed.rotate(angle * dir, pivot), [angle, dir, pivot]);
  return (
    <WinDialog title="Rotate by" width={340} onClose={live.cancel} footer={<OkCancel onOk={live.ok} onCancel={live.cancel} />}>
      <div className="win-pad">
        <div>Enter an angle to rotate by:</div>
        <div className="win-track-line">
          <input type="range" min={-180} max={180} step={1} value={angle} onChange={(e) => setAngle(Number(e.target.value))} />
          <NumberBox value={angle} min={-360} max={360} step={1} width={56} onChange={setAngle} /> °
        </div>
        <div className="win-cols">
          <GroupBox title="Direction">
            <Radio name="rdir" label="Clockwise" checked={dir === 1} onChange={() => setDir(1)} /><br />
            <Radio name="rdir" label="Anti-Clockwise" checked={dir === -1} onChange={() => setDir(-1)} />
          </GroupBox>
          <GroupBox title="Origin">
            <Radio name="rorg" label="Playfield Centre" checked={pivot === 'playfield'} onChange={() => setPivot('playfield')} /><br />
            <Radio name="rorg" label="Selection Centre" checked={pivot === 'selection'} onChange={() => setPivot('selection')} />
          </GroupBox>
        </div>
      </div>
    </WinDialog>
  );
}

export function ScaleDialog() {
  const ed = useEditor();
  const [factor, setFactor] = useState(1);
  const [pivot, setPivot] = useState<'playfield' | 'selection'>('playfield');
  const [axes, setAxes] = useState({ x: true, y: true });
  const live = useLivePreview(() => factor !== 1 && ed.scale(factor, pivot, axes), [factor, pivot, axes.x, axes.y]);
  return (
    <WinDialog title="Scale by" width={330} onClose={live.cancel} footer={<OkCancel onOk={live.ok} onCancel={live.cancel} />}>
      <div className="win-pad">
        <div>Scale the selected objects' spacing by:</div>
        <div className="win-track-line">
          <input type="range" min={0.5} max={1.5} step={0.01} value={factor} onChange={(e) => setFactor(Number(e.target.value))} />
          <NumberBox value={factor} min={0.1} max={4} step={0.01} digits={3} width={60} onChange={setFactor} /> ×
        </div>
        <div className="win-cols">
          <GroupBox title="Origin">
            <Radio name="sorg" label="Playfield Centre" checked={pivot === 'playfield'} onChange={() => setPivot('playfield')} /><br />
            <Radio name="sorg" label="Selection Centre" checked={pivot === 'selection'} onChange={() => setPivot('selection')} />
          </GroupBox>
          <GroupBox title="Apply to">
            <Check label="X-axis" checked={axes.x} onChange={(v) => setAxes({ ...axes, x: v })} /><br />
            <Check label="Y-axis" checked={axes.y} onChange={(v) => setAxes({ ...axes, y: v })} />
          </GroupBox>
        </div>
      </div>
    </WinDialog>
  );
}

export function PolygonDialog() {
  const ed = useEditor();
  const [points, setPoints] = useState(4);
  const [spacing, setSpacing] = useState(1);
  const [offset, setOffset] = useState(0);
  const [repeats, setRepeats] = useState(1);

  const create = () => {
    const bm = ed.bm;
    const start = Math.round(ed.snap(music.time));
    const step = beatLengthAt(bm, start) / ed.beatDivisor;
    const side = (expectedDistance(start, start + step) * spacing) / (bm.editor.distanceSpacing || 1);
    const radius = side / (2 * Math.sin(Math.PI / points));
    const centre = { x: 256, y: 192 };
    const objs: HitObject[] = [];
    const total = points * repeats;
    for (let i = 0; i < total; i++) {
      const ang = (offset * Math.PI) / 180 - Math.PI / 2 + (i * 2 * Math.PI) / points;
      objs.push({
        id: newObjectId(),
        kind: 'circle',
        x: Math.round(centre.x + Math.cos(ang) * radius),
        y: Math.round(centre.y + Math.sin(ang) * radius),
        time: Math.round(start + i * step),
        newCombo: i === 0,
        comboSkip: 0,
        hitSound: 0,
        sample: defaultSample(),
      });
    }
    ed.commit((b) => {
      const times = new Set(objs.map((o) => o.time));
      b.hitObjects = b.hitObjects.filter((o) => !times.has(o.time));
      b.hitObjects.push(...objs);
    });
    ed.setTool('select');
    ed.select(objs.map((o) => o.id));
    ed.openDialog(null);
  };

  return (
    <WinDialog title="Create Polygon Circles" width={360} onClose={() => ed.openDialog(null)} footer={<OkCancel onOk={create} onCancel={() => ed.openDialog(null)} />}>
      <div className="win-pad">
        <p className="win-muted">Circles go around the playfield centre, starting at the current time and spaced by the beat snap divisor (1/{ed.beatDivisor}).</p>
        <TrackRow label="Distance Snap" value={spacing} min={0.1} max={6} step={0.1} onChange={setSpacing} />
        <TrackRow label="Offset Angle" value={offset} min={0} max={180} step={1} onChange={setOffset} />
        <TrackRow label="Points" value={points} min={3} max={12} step={1} onChange={(v) => setPoints(Math.round(v))} />
        <TrackRow label="Repeats" value={repeats} min={1} max={10} step={1} onChange={(v) => setRepeats(Math.round(v))} />
      </div>
    </WinDialog>
  );
}

export function StreamDialog() {
  const ed = useEditor();
  const [by, setBy] = useState<'divisor' | 'count'>('divisor');
  const [divisor, setDivisor] = useState(ed.beatDivisor);
  const [count, setCount] = useState(8);
  const [keepSounds, setKeepSounds] = useState(true);
  const sliders = ed.selectedObjects.filter((o) => o.kind === 'slider');

  const convert = () => {
    const bm = ed.bm;
    const created: HitObject[] = [];
    for (const s of sliders) {
      if (s.kind !== 'slider') continue;
      const span = sliderSpanDuration(bm, s);
      const total = span * s.slides;
      const step = by === 'divisor' ? beatLengthAt(bm, s.time) / divisor : total / Math.max(1, count - 1);
      for (let t = s.time, i = 0; t <= s.time + total + 1; t += step, i++) {
        const pos = sliderPositionAtSpan(s, Math.min(s.slides, (t - s.time) / span));
        const edgeIndex = Math.round((t - s.time) / span);
        const atEdge = Math.abs(s.time + edgeIndex * span - t) < 2;
        created.push({
          id: newObjectId(),
          kind: 'circle',
          x: Math.round(pos.x),
          y: Math.round(pos.y),
          time: Math.round(t),
          newCombo: i === 0 && s.newCombo,
          comboSkip: i === 0 ? s.comboSkip : 0,
          hitSound: keepSounds && atEdge ? s.edgeSounds[edgeIndex] ?? 0 : 0,
          sample: { ...s.sample, ...(keepSounds && atEdge ? { normalSet: s.edgeSets[edgeIndex]?.normal || s.sample.normalSet, additionSet: s.edgeSets[edgeIndex]?.addition || s.sample.additionSet } : {}) },
        });
      }
    }
    const ids = new Set(sliders.map((s) => s.id));
    ed.commit((b) => {
      b.hitObjects = b.hitObjects.filter((o) => !ids.has(o.id));
      b.hitObjects.push(...created);
    });
    ed.select(created.map((o) => o.id));
    ed.openDialog(null);
  };

  return (
    <WinDialog title="Convert slider to stream" width={340} onClose={() => ed.openDialog(null)} footer={<OkCancel onOk={convert} onCancel={() => ed.openDialog(null)} okDisabled={!sliders.length} />}>
      <div className="win-pad">
        {!sliders.length && <p className="win-note">Select one or more sliders first.</p>}
        <GroupBox title="Spacing">
          <div className="tsd-custom">
            <Radio name="sby" label="Beat snap divisor" checked={by === 'divisor'} onChange={() => setBy('divisor')} />
            <select value={divisor} disabled={by !== 'divisor'} onChange={(e) => setDivisor(Number(e.target.value))}>
              {DIVISORS.map((d) => <option key={d} value={d}>1/{d}</option>)}
            </select>
          </div>
          <div className="tsd-custom">
            <Radio name="sby" label="Number of objects" checked={by === 'count'} onChange={() => setBy('count')} />
            <NumberBox value={count} min={2} max={64} step={1} width={56} disabled={by !== 'count'} onChange={(v) => setCount(Math.round(v))} />
          </div>
        </GroupBox>
        <Check label="Keep the hitsounds of slider edges" checked={keepSounds} onChange={setKeepSounds} />
      </div>
    </WinDialog>
  );
}

interface CompletionState {
  free: FreeVariable;
  duration: 'keep' | 'beats' | 'now';
  beats: number;
  keepLength: boolean;
  completion: number;
  keepSv: boolean;
  sv: number;
  moveAnchors: boolean;
}

// Both tools remember their settings for the session, like Mapping Tools does.
let lastCompletion: CompletionState = { free: 'velocity', duration: 'keep', beats: 1, keepLength: false, completion: 100, keepSv: true, sv: 1, moveAnchors: false };
let lastMerge: MergeOptions = { leniency: 256, connection: 'move', linearOnLinear: false };

/** Tools → Slider Completionator: works out a slider's SV, length or duration from the other two. */
export function CompletionatorDialog() {
  const ed = useEditor();
  const [st, setSt] = useState(lastCompletion);
  const set = (p: Partial<CompletionState>) => setSt((s) => (lastCompletion = { ...s, ...p }));
  const sliders = ed.selectedObjects.filter((o): o is Slider => o.kind === 'slider');
  const now = music.time;
  const opts: CompletionOptions = {
    free: st.free,
    beats: st.free !== 'duration' && st.duration === 'beats' ? st.beats : null,
    endTime: st.free !== 'duration' && st.duration === 'now' ? now : null,
    completion: st.free !== 'length' && !st.keepLength ? st.completion / 100 : null,
    sv: st.free !== 'velocity' && !st.keepSv ? st.sv : null,
    moveAnchors: st.moveAnchors,
  };
  const plans = planCompletion(ed.bm, sliders, opts);
  const good = plans.filter((p) => !p.error);
  const bad = plans.filter((p) => p.error);
  const svs = good.map((p) => p.sv);
  const x = (v: number) => `${v.toFixed(2)}×`;

  const apply = () => {
    ed.commit((b) => applyCompletion(b, plans, opts));
    for (const p of bad) ed.toast(`Skipped the slider at ${formatTimestamp(p.slider.time)}: ${p.error}.`, 'error');
    ed.openDialog(null);
  };
  const calculated = (v: FreeVariable) => (st.free === v ? <span className="win-muted">worked out from the other two</span> : null);

  return (
    <WinDialog title="Slider Completionator" width={420} onClose={() => ed.openDialog(null)} footer={<OkCancel onOk={apply} onCancel={() => ed.openDialog(null)} okDisabled={!good.length} />}>
      <div className="win-pad">
        {!sliders.length && <p className="win-note">Select one or more sliders first.</p>}
        <GroupBox title="Work out">
          <Radio name="cfree" label="Slider velocity" checked={st.free === 'velocity'} onChange={() => set({ free: 'velocity' })} />{' '}
          <Radio name="cfree" label="Length" checked={st.free === 'length'} onChange={() => set({ free: 'length' })} />{' '}
          <Radio name="cfree" label="Duration" checked={st.free === 'duration'} onChange={() => set({ free: 'duration' })} />
        </GroupBox>
        <GroupBox title="Duration">
          {calculated('duration') ?? (
            <>
              <Radio name="cdur" label="Keep" checked={st.duration === 'keep'} onChange={() => set({ duration: 'keep' })} />
              <div className="tsd-custom">
                <Radio name="cdur" label="Beats (all repeats)" checked={st.duration === 'beats'} onChange={() => set({ duration: 'beats' })} />
                <NumberBox value={st.beats} min={0.01} max={64} step={0.25} digits={3} width={56} disabled={st.duration !== 'beats'} onChange={(v) => set({ beats: v })} />
              </div>
              <Radio name="cdur" label={`End at the current time (${formatTimestamp(now)})`} checked={st.duration === 'now'} onChange={() => set({ duration: 'now' })} />
            </>
          )}
        </GroupBox>
        <GroupBox title="Length">
          {calculated('length') ?? (
            <>
              <Radio name="clen" label="Keep" checked={st.keepLength} onChange={() => set({ keepLength: true })} />
              <div className="tsd-custom">
                <Radio name="clen" label="Percent of the path to the last anchor" checked={!st.keepLength} onChange={() => set({ keepLength: false })} />
                <NumberBox value={st.completion} min={1} max={1000} step={5} width={56} disabled={st.keepLength} onChange={(v) => set({ completion: v })} /> %
              </div>
            </>
          )}
          <Check label="Move the anchors so the slider ends on the last one" checked={st.moveAnchors} onChange={(v) => set({ moveAnchors: v })} />
        </GroupBox>
        <GroupBox title="Slider velocity">
          {calculated('velocity') ?? (
            <>
              <Radio name="csv" label="Keep" checked={st.keepSv} onChange={() => set({ keepSv: true })} />
              <div className="tsd-custom">
                <Radio name="csv" label="Set to" checked={!st.keepSv} onChange={() => set({ keepSv: false })} />
                <NumberBox value={st.sv} min={0.1} max={10} step={0.05} digits={3} width={56} disabled={st.keepSv} onChange={(v) => set({ sv: v })} /> ×
              </div>
            </>
          )}
        </GroupBox>
        {good.length === 1 && (
          <p className="win-muted">
            Length {good[0].slider.length.toFixed(1)} → {good[0].length.toFixed(1)} px, SV {x(good[0].oldSv)} → {x(good[0].sv)}
          </p>
        )}
        {good.length > 1 && (
          <p className="win-muted">
            {good.length} sliders, SV {x(Math.min(...svs))}{Math.max(...svs) - Math.min(...svs) > 0.005 ? ` to ${x(Math.max(...svs))}` : ''}. Green lines are added where the SV changes, and the sliders after them keep theirs.
          </p>
        )}
        {bad.length > 0 && <p className="win-note">{bad.length} slider{bad.length > 1 ? 's are' : ' is'} skipped: {bad[0].error}.</p>}
      </div>
    </WinDialog>
  );
}

/** Tools → Slider Merger: joins neighbouring circles and sliders of the selection into sliders. */
export function MergerDialog() {
  const ed = useEditor();
  const [o, setO] = useState(lastMerge);
  const set = (p: Partial<MergeOptions>) => setO((s) => (lastMerge = { ...s, ...p }));
  const selected = ed.selectedObjects;
  const plan = useMemo(() => planMerge(selected, o), [ed.contentRev, ed.rev, o]); // eslint-disable-line react-hooks/exhaustive-deps
  const merge = () => {
    ed.commit((b) => applyMerge(b, plan));
    ed.select(plan.merged.map((s) => s.id));
    ed.openDialog(null);
  };
  return (
    <WinDialog title="Slider Merger" width={420} onClose={() => ed.openDialog(null)} footer={<OkCancel onOk={merge} onCancel={() => ed.openDialog(null)} okDisabled={!plan.merged.length} />}>
      <div className="win-pad">
        <p className="win-muted">
          Joins the selected circles and sliders, in time order, wherever one ends near where the next starts. Each merged slider keeps the
          first object's time; Slider Completionator can then make it end on the beat you want.
        </p>
        <Row label="Leniency" hint="The largest gap between one object's end and the next one's start that still merges">
          <NumberBox value={o.leniency} min={0} max={1000} step={8} width={56} onChange={(v) => set({ leniency: v })} /> px
        </Row>
        <GroupBox title="Connect sliders by">
          <Radio name="mconn" label="Moving the next slider to where the previous one ends" checked={o.connection === 'move'} onChange={() => set({ connection: 'move' })} /><br />
          <Radio name="mconn" label="Joining them with a straight line" checked={o.connection === 'linear'} onChange={() => set({ connection: 'linear' })} />
        </GroupBox>
        <Check label="Keep straight results linear (no red anchors)" checked={o.linearOnLinear} onChange={(v) => set({ linearOnLinear: v })} />
        <p className={plan.merged.length ? 'win-muted' : 'win-note'}>
          {plan.merged.length
            ? `${plan.merged.length + plan.removed.size} objects merge into ${plan.merged.length} slider${plan.merged.length > 1 ? 's' : ''}.`
            : selected.length < 2
              ? 'Select two or more circles or sliders first.'
              : 'Nothing in the selection is close enough to merge.'}
        </p>
      </div>
    </WinDialog>
  );
}

/** Ctrl+O: pick another difficulty of this set to edit. */
export function DifficultiesDialog() {
  const ed = useEditor();
  const p = ed.project!;
  const [sel, setSel] = useState(ed.diffIndex);
  const open = () => {
    ed.openDialog(null);
    void ed.requestSwitchDifficulty(p.difficulties[sel].id);
  };
  return (
    <WinDialog title="Open Difficulty" width={380} onClose={() => ed.openDialog(null)} footer={<OkCancel okLabel="Open" onOk={open} onCancel={() => ed.openDialog(null)} />}>
      <div className="win-list" style={{ height: 220 }}>
        <table>
          <thead><tr><th>Difficulty</th><th>Mode</th><th>Objects</th></tr></thead>
          <tbody>
            {p.difficulties.map((d, i) => (
              <tr key={d.id} className={i === sel ? 'sel focus' : ''} onMouseDown={() => setSel(i)} onDoubleClick={open}>
                <td>{d.beatmap.metadata.version || '(unnamed)'}{i === ed.diffIndex ? ' (current)' : ''}</td>
                <td>{['osu!', 'osu!taiko', 'osu!catch', 'osu!mania'][d.beatmap.general.mode]}</td>
                <td>{d.beatmap.hitObjects.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="win-buttonrow">
        <button onClick={() => { ed.openDialog(null); void ed.beginNewDifficulty(); }}>Create a new Difficulty...</button>
        <button
          disabled={p.difficulties.length <= 1}
          onClick={async () => {
            const d = p.difficulties[sel];
            if (await confirmBox('osu!', `Delete the difficulty "${d.beatmap.metadata.version}"? It is removed when you save.`)) {
              ed.deleteDifficulty(sel);
              setSel(Math.min(sel, p.difficulties.length - 1));
            }
          }}
        >
          Delete...
        </button>
      </div>
    </WinDialog>
  );
}

/** File → Open Song Folder: the beatmap set's folder, laid out like the Explorer window stable opens. */
export function FilesDialog() {
  const ed = useEditor();
  const folder = ed.project!.files;
  const setName = oszFilename(ed.project!).replace(/\.osz$/, '');
  const [dir, setDir] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const anchor = useRef<string | null>(null);
  const close = () => ed.openDialog(null);
  const prefix = dir ? `${dir}/` : '';
  // The open folder's direct children; a subfolder is one row holding the total size of the files under it.
  const children = new Map<string, { path: string; size: number; isDir: boolean }>();
  for (const [path, blob] of folder) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const row = children.get(name) ?? { path: prefix + name, size: 0, isDir: slash >= 0 };
    row.size += blob.size;
    children.set(name, row);
  }
  const rows = [...children].sort(([a, x], [b, y]) => Number(y.isDir) - Number(x.isDir) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  // A selected folder stands for every file under it.
  const expand = (paths: string[]) => [...folder.keys()].filter((k) => paths.some((p) => k === p || k.startsWith(`${p}/`)));
  const open = (path: string) => {
    setDir(path);
    setSel([]);
    anchor.current = null;
  };
  const up = () => dir && open(dir.split('/').slice(0, -1).join('/'));
  const refreshSamples = () => hitsounds.setCustomSamples(folder, ed.bm.general.audioFilename);
  // Folder picks and drops keep their path, so a dropped sb folder lands in sb/ like in Explorer.
  const add = async (picked: File[]) => {
    if (!picked.length) return;
    ed.setFiles(picked.map((f) => [prefix + (f.webkitRelativePath || f.name), f]));
    ed.toast(`Added ${picked.length} file${picked.length > 1 ? 's' : ''}. Custom hitsounds are picked up by name (e.g. soft-hitclap2.wav).`);
    await refreshSamples();
  };
  const remove = async () => {
    const doomed = expand(sel);
    if (doomed.includes(ed.bm.general.audioFilename)) return ed.toast('This is the audio file; replace it from Song Setup → Audio instead.', 'error');
    const what = sel.length === 1 ? `"${sel[0].slice(prefix.length)}"` : `these ${sel.length} items`;
    if (await confirmBox('osu!', `Delete ${what}${doomed.length > sel.length ? ` (${doomed.length} files)` : ''} from the beatmap folder?`)) {
      ed.setFiles(doomed.map((n) => [n, null]));
      setSel([]);
      await refreshSamples();
    }
  };
  // Click picks one, Ctrl+click toggles, Shift+click picks a range, like an Explorer list.
  const pick = (e: MouseEvent, path: string) => {
    const at = rows.findIndex(([, r]) => r.path === anchor.current);
    if (e.shiftKey && at >= 0) {
      const i = rows.findIndex(([, r]) => r.path === path);
      return setSel(rows.slice(Math.min(at, i), Math.max(at, i) + 1).map(([, r]) => r.path));
    }
    anchor.current = path;
    if (e.ctrlKey || e.metaKey) setSel(sel.includes(path) ? sel.filter((n) => n !== path) : [...sel, path]);
    else setSel([path]);
  };
  const selSize = expand(sel).reduce((s, n) => s + folder.get(n)!.size, 0);
  const shown = sel.length === 1 ? folder.get(sel[0]) : undefined;
  const parts = dir ? dir.split('/') : [];
  return (
    <WinDialog title={setName} width={820} className="xp" onClose={close}>
      <div className="xp-bar">
        <button className="xp-btn" onClick={async () => add(await pickFiles('*', { multiple: true }))}><span className="xp-glyph">＋</span>Add files</button>
        <button className="xp-btn" onClick={async () => add(await pickFiles('*', { directory: true }))}><span className="xp-glyph">📁</span>Add folder</button>
        <span className="xp-sep" />
        <button className="xp-btn" disabled={!sel.length} onClick={() => expand(sel).forEach((n) => downloadBlob(folder.get(n)!, n.split('/').pop()!))}><span className="xp-glyph">⭳</span>Download</button>
        <button className="xp-btn" disabled={!sel.length} onClick={() => void remove()}><span className="xp-glyph">🗑</span>Delete</button>
      </div>
      <div className="xp-address">
        <button className="xp-btn xp-up" disabled={!dir} onClick={up} aria-label="Up one folder">↑</button>
        <div className="xp-crumbs">
          <span className="xp-glyph">📁</span>
          <span className="xp-chev">›</span>
          <button className="xp-btn xp-crumb" onClick={() => open('')}>{setName}</button>
          {parts.map((p, i) => (
            <span key={i}>
              <span className="xp-chev">›</span>
              <button className="xp-btn xp-crumb" onClick={() => open(parts.slice(0, i + 1).join('/'))}>{p}</button>
            </span>
          ))}
        </div>
      </div>
      <div className="xp-main">
        <div
          className={`xp-list ${over ? 'over' : ''}`}
          tabIndex={0}
          onMouseDown={(e) => e.target === e.currentTarget && setSel([])}
          onKeyDown={(e) => {
            if (e.key === 'Delete' && sel.length) void remove();
            else if (e.key === 'Backspace') up();
            else if (e.key === 'Enter' && sel.length === 1 && children.get(sel[0].slice(prefix.length))?.isDir) open(sel[0]);
            else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) setSel(rows.map(([, r]) => r.path));
            else return;
            e.preventDefault();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setOver(false);
            await add(await filesFromDrop(e.dataTransfer));
          }}
        >
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Size</th></tr></thead>
            <tbody>
              {rows.map(([name, r]) => (
                <tr key={r.path} className={sel.includes(r.path) ? 'sel' : ''} onMouseDown={(e) => pick(e, r.path)} onDoubleClick={() => r.isDir && open(r.path)}>
                  <td><span className="xp-icon">{fileIcon(name, r.isDir)}</span>{name}</td>
                  <td>{r.isDir ? 'File folder' : `${name.includes('.') ? name.split('.').pop()!.toUpperCase() : ''} File`}</td>
                  <td>{r.isDir ? '' : kb(r.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="xp-empty">This folder is empty. Drop files here to add them.</div>}
        </div>
        <div className="xp-preview">
          {shown ? (
            <>
              <FilePreview name={sel[0]} blob={shown} />
              <b>{sel[0].slice(prefix.length)}</b>
              <span>{kb(shown.size)}</span>
            </>
          ) : (
            <span>{sel.length ? `${sel.length} items selected` : 'Select a file to preview it. Drop files or folders on the list to add them.'}</span>
          )}
        </div>
      </div>
      <div className="xp-status">
        <span>{rows.length} item{rows.length === 1 ? '' : 's'}</span>
        {sel.length > 0 && <span>{sel.length} item{sel.length === 1 ? '' : 's'} selected  {selSize < 1048576 ? kb(selSize) : `${(selSize / 1048576).toFixed(1)} MB`}</span>}
      </div>
    </WinDialog>
  );
}

/** Explorer rounds sizes up to the next KB. */
const kb = (bytes: number) => `${Math.ceil(bytes / 1024).toLocaleString()} KB`;

function fileIcon(name: string, isDir: boolean) {
  if (isDir) return '📁';
  const type = mimeFor(name);
  return type.startsWith('image/') ? '🖼️' : type.startsWith('audio/') ? '🎵' : type.startsWith('video/') ? '🎬' : '📄';
}

/** The selected file, so a mapper can check which bg or hitsound it is without leaving the editor. */
function FilePreview({ name, blob }: { name: string; blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const type = mimeFor(name);
  if (!url) return null;
  if (type.startsWith('image/')) return <img className="xp-media" src={url} alt={name} />;
  if (type.startsWith('audio/')) return <audio key={url} src={url} controls autoPlay style={{ width: '100%' }} />;
  if (type === 'video/mp4') return <video key={url} className="xp-media" src={url} controls muted />;
  return <span className="xp-bigicon">{fileIcon(name, false)}</span>;
}

/** File → Open .osu / .osb in Notepad: the raw text, editable, in a Notepad-style window. */
export function NotepadDialog({ kind }: { kind: 'osu' | 'osb' }) {
  const ed = useEditor();
  const initial = kind === 'osu' ? serializeBeatmap(ed.bm) : '';
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [caret, setCaret] = useState(0);
  storyboard.sync();
  const osbName = storyboard.osbName;
  const fileName = kind === 'osu' ? osuFilename(ed.bm) : osbName;
  useEffect(() => {
    if (kind !== 'osb') return;
    const blob = ed.project!.files.get(osbName);
    const load = (t: string) => {
      setText(t);
      setSaved(t);
    };
    if (blob) void blob.text().then(load);
    else load('[Events]\n//Background and Video events\n//Storyboard Layer 0 (Background)\n//Storyboard Layer 1 (Fail)\n//Storyboard Layer 2 (Pass)\n//Storyboard Layer 3 (Foreground)\n//Storyboard Layer 4 (Overlay)\n//Storyboard Sound Samples\n');
  }, [kind, osbName]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = text !== saved;
  const save = () => {
    if (kind === 'osu') {
      try {
        const parsed = parseOsu(text);
        ed.commit((b) => Object.assign(b, parsed));
        ed.select([]);
      } catch (e) {
        return ed.toast(`Couldn't read that .osu: ${(e as Error).message}`, 'error');
      }
    } else {
      ed.setFile(osbName, new Blob([text.replace(/\r?\n/g, '\r\n')], { type: 'text/plain' }));
      design.select(null);
    }
    setSaved(text);
    ed.toast(`Saved ${fileName}.`);
  };
  const close = async () => {
    if (!dirty || (await confirmBox('Notepad', `Close without saving your changes to ${fileName}?`))) ed.openDialog(null);
  };
  const before = text.slice(0, caret);
  return (
    <WinDialog title={`${dirty ? '*' : ''}${fileName} - Notepad`} width={860} className="np" onClose={() => void close()}>
      <div className="np-menu">
        <button className="xp-btn" onClick={save} title="Ctrl+S">Save</button>
        <button className="xp-btn" onClick={() => setText(saved)} disabled={!dirty}>Revert</button>
      </div>
      <textarea
        className="np-text"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="np-status">
        <span>Ln {before.split('\n').length}, Col {caret - before.lastIndexOf('\n')}</span>
        <span>{text.length.toLocaleString()} characters</span>
        <span>Windows (CRLF)</span>
        <span>UTF-8</span>
      </div>
    </WinDialog>
  );
}

/** Per-object sample volume, custom sample index and combo colour skip for the selection. */
export function ObjectSettingsDialog() {
  const ed = useEditor();
  const sel = ed.selectedObjects;
  const same = <T,>(f: (o: HitObject) => T) => (sel.every((o) => f(o) === f(sel[0])) ? f(sel[0]) : null);
  const [vol, setVol] = useState(same((o) => o.sample.volume) ?? 0);
  const [idx, setIdx] = useState(same((o) => o.sample.index) ?? 0);
  const [skip, setSkip] = useState(same((o) => o.comboSkip) ?? 0);
  const ok = () => {
    ed.commit(() =>
      sel.forEach((o) => {
        o.sample.volume = vol;
        o.sample.index = idx;
        if (o.newCombo) o.comboSkip = skip;
      }),
    );
    ed.openDialog(null);
  };
  return (
    <WinDialog title="Sample volume and colour skip" width={360} onClose={() => ed.openDialog(null)} footer={<OkCancel onOk={ok} onCancel={() => ed.openDialog(null)} okDisabled={!sel.length} />}>
      <div className="win-pad">
        <p className="win-muted">{sel.length} selected object{sel.length === 1 ? '' : 's'}. 0 means "use the timing section".</p>
        <Row label="Sample volume"><NumberBox value={vol} min={0} max={100} step={5} onChange={(v) => setVol(Math.round(v))} /></Row>
        <Row label="Custom sample index"><NumberBox value={idx} min={0} step={1} onChange={(v) => setIdx(Math.round(v))} /></Row>
        <Row label="Combo colour skip" hint="Only for objects that start a new combo"><NumberBox value={skip} min={0} max={7} step={1} onChange={(v) => setSkip(Math.round(v))} /></Row>
      </div>
    </WinDialog>
  );
}
