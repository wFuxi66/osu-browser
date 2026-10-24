import { useEffect, useRef, useState } from 'react';
import { hitsounds } from '../../../audio/hitsounds';
import { music } from '../../../audio/music';
import { sliderPositionAtSpan } from '../../../osu/curves';
import { parseOsu } from '../../../osu/parser';
import { serializeBeatmap } from '../../../osu/serializer';
import { beatLengthAt, sliderSpanDuration } from '../../../osu/timing';
import { defaultSample, newObjectId, type HitObject } from '../../../osu/types';
import { pickFiles } from '../../../project/open';
import { confirmBox } from '../../../ui/prompt';
import { Check, GroupBox, NumberBox, OkCancel, Radio, Row, TrackRow, WinDialog } from '../../../ui/win';
import { expectedDistance } from '../../playfield/snapping';
import { DIVISORS } from '../../shortcuts';
import { storyboard } from '../../storyboard/runtime';
import { design } from '../../storyboard/design';
import { editor, useEditor } from '../../store';

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

/** File → Open Song Folder: the files in the beatmap set. */
export function FilesDialog() {
  const ed = useEditor();
  const files = [...ed.project!.files.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const [sel, setSel] = useState<string | null>(null);
  const add = async () => {
    const picked = await pickFiles('*', { multiple: true });
    for (const f of picked) ed.setFile(f.name, f);
    if (picked.length) {
      ed.toast(`Added ${picked.length} file${picked.length > 1 ? 's' : ''}. Custom hitsounds are picked up by name (e.g. soft-hitclap2.wav).`);
      await hitsounds.setCustomSamples(ed.project!.files, ed.bm.general.audioFilename);
    }
  };
  const remove = async () => {
    if (!sel) return;
    if (sel === ed.bm.general.audioFilename) return ed.toast('This is the audio file; replace it from Song Setup → Audio instead.', 'error');
    if (await confirmBox('osu!', `Remove ${sel} from the beatmap folder?`)) {
      ed.setFile(sel, null);
      setSel(null);
    }
  };
  return (
    <WinDialog title="Song Folder" width={520} onClose={() => ed.openDialog(null)} footer={<OkCancel onOk={() => ed.openDialog(null)} onCancel={() => ed.openDialog(null)} />}>
      <div className="win-list" style={{ height: 300 }}>
        <table>
          <thead><tr><th>Name</th><th>Size</th></tr></thead>
          <tbody>
            {files.map(([name, blob]) => (
              <tr key={name} className={sel === name ? 'sel focus' : ''} onMouseDown={() => setSel(name)}>
                <td className="win-mono">{name}</td>
                <td>{Math.max(1, Math.round(blob.size / 1024)).toLocaleString()} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="win-buttonrow">
        <button onClick={() => void add()}>Add files...</button>
        <button onClick={() => void remove()} disabled={!sel}>Remove</button>
      </div>
    </WinDialog>
  );
}

/** File → Open .osu / .osb in Notepad: the raw text, editable. */
export function NotepadDialog({ kind }: { kind: 'osu' | 'osb' }) {
  const ed = useEditor();
  const [text, setText] = useState(kind === 'osu' ? serializeBeatmap(ed.bm) : '');
  storyboard.sync();
  const osbName = storyboard.osbName;
  useEffect(() => {
    if (kind !== 'osb') return;
    const blob = ed.project!.files.get(osbName);
    if (blob) void blob.text().then(setText);
    else setText('[Events]\n//Background and Video events\n//Storyboard Layer 0 (Background)\n//Storyboard Layer 1 (Fail)\n//Storyboard Layer 2 (Pass)\n//Storyboard Layer 3 (Foreground)\n//Storyboard Layer 4 (Overlay)\n//Storyboard Sound Samples\n');
  }, [kind, osbName]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
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
    ed.openDialog(null);
  };
  return (
    <WinDialog title={`${kind === 'osu' ? 'Difficulty' : osbName} - Notepad`} width={760} onClose={() => ed.openDialog(null)} footer={<OkCancel okLabel="Apply" onOk={apply} onCancel={() => ed.openDialog(null)} />}>
      <textarea className="win-textarea" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
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
