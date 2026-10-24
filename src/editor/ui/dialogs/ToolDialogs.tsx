import { useState } from 'react';
import { music } from '../../../audio/music';
import { sliderPositionAtSpan } from '../../../osu/curves';
import { beatLengthAt, sliderSpanDuration } from '../../../osu/timing';
import { defaultSample, newObjectId, type HitObject } from '../../../osu/types';
import { expectedDistance } from '../../playfield/snapping';
import { editor, useEditor } from '../../store';
import { Field, Modal, SliderField } from './Modal';

export function RotateDialog() {
  const ed = useEditor();
  const [angle, setAngle] = useState(45);
  const [pivot, setPivot] = useState<'playfield' | 'selection'>('selection');
  const [dir, setDir] = useState<1 | -1>(1);
  return (
    <Modal
      title="Rotate by…"
      footer={
        <>
          <button onClick={() => ed.openDialog(null)}>Cancel</button>
          <button className="primary" onClick={() => { ed.rotate(angle * dir, pivot); ed.openDialog(null); }}>Rotate</button>
        </>
      }
    >
      <SliderField label="Angle (degrees)" value={angle} min={0} max={360} step={1} onChange={setAngle} />
      <Field label="Direction">
        <select value={dir} onChange={(e) => setDir(Number(e.target.value) as 1 | -1)}>
          <option value={1}>Clockwise</option>
          <option value={-1}>Anticlockwise</option>
        </select>
      </Field>
      <Field label="Origin">
        <select value={pivot} onChange={(e) => setPivot(e.target.value as 'playfield' | 'selection')}>
          <option value="selection">Selection centre</option>
          <option value="playfield">Playfield centre</option>
        </select>
      </Field>
    </Modal>
  );
}

export function ScaleDialog() {
  const ed = useEditor();
  const [factor, setFactor] = useState(1);
  const [pivot, setPivot] = useState<'playfield' | 'selection'>('selection');
  const [axes, setAxes] = useState({ x: true, y: true });
  return (
    <Modal
      title="Scale by…"
      footer={
        <>
          <button onClick={() => ed.openDialog(null)}>Cancel</button>
          <button className="primary" onClick={() => { ed.scale(factor, pivot, axes); ed.openDialog(null); }}>Scale</button>
        </>
      }
    >
      <SliderField label="Scale" value={factor} min={0.5} max={2} step={0.01} onChange={setFactor} />
      <Field label="Axes">
        <label><input type="checkbox" checked={axes.x} onChange={(e) => setAxes({ ...axes, x: e.target.checked })} /> X</label>
        <label><input type="checkbox" checked={axes.y} onChange={(e) => setAxes({ ...axes, y: e.target.checked })} /> Y</label>
      </Field>
      <Field label="Origin">
        <select value={pivot} onChange={(e) => setPivot(e.target.value as 'playfield' | 'selection')}>
          <option value="selection">Selection centre</option>
          <option value="playfield">Playfield centre</option>
        </select>
      </Field>
    </Modal>
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
    const side = expectedDistance(start, start + step) * spacing / (bm.editor.distanceSpacing || 1);
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
    ed.select(objs.map((o) => o.id));
    ed.openDialog(null);
  };

  return (
    <Modal
      title="Polygon circles"
      footer={
        <>
          <button onClick={() => ed.openDialog(null)}>Cancel</button>
          <button className="primary" onClick={create}>Create</button>
        </>
      }
    >
      <p className="muted">Places circles in a regular polygon around the playfield centre, starting at the current time and spaced by the beat snap divisor.</p>
      <SliderField label="Distance snap" value={spacing} min={0.1} max={6} step={0.1} onChange={setSpacing} />
      <SliderField label="Offset angle" value={offset} min={0} max={180} step={1} onChange={setOffset} />
      <SliderField label="Points" value={points} min={3} max={12} step={1} onChange={setPoints} />
      <SliderField label="Repeats" value={repeats} min={1} max={10} step={1} onChange={setRepeats} />
    </Modal>
  );
}

export function StreamDialog() {
  const ed = useEditor();
  const [divisor, setDivisor] = useState(ed.beatDivisor);
  const [keepSounds, setKeepSounds] = useState(true);
  const sliders = ed.selectedObjects.filter((o) => o.kind === 'slider');

  const convert = () => {
    const bm = ed.bm;
    const created: HitObject[] = [];
    for (const s of sliders) {
      if (s.kind !== 'slider') continue;
      const span = sliderSpanDuration(bm, s);
      const end = s.time + span * s.slides;
      const step = beatLengthAt(bm, s.time) / divisor;
      for (let t = s.time, i = 0; t <= end + 1; t += step, i++) {
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
    <Modal
      title="Convert slider to stream"
      footer={
        <>
          <button onClick={() => ed.openDialog(null)}>Cancel</button>
          <button className="primary" onClick={convert} disabled={!sliders.length}>Convert</button>
        </>
      }
    >
      {!sliders.length && <p>Select one or more sliders first.</p>}
      <Field label="Beat snap divisor">
        <select value={divisor} onChange={(e) => setDivisor(Number(e.target.value))}>
          {[1, 2, 3, 4, 6, 8, 12, 16].map((d) => <option key={d} value={d}>1/{d}</option>)}
        </select>
      </Field>
      <Field label="Keep hitsounds on slider edges">
        <input type="checkbox" checked={keepSounds} onChange={(e) => setKeepSounds(e.target.checked)} />
      </Field>
    </Modal>
  );
}

export function DifficultiesDialog() {
  const ed = useEditor();
  const p = ed.project!;
  return (
    <Modal title="Difficulties" footer={<button onClick={() => ed.openDialog('newDifficulty')}>Create new difficulty…</button>}>
      <ul className="diff-list">
        {p.difficulties.map((d, i) => (
          <li key={d.id} className={i === ed.diffIndex ? 'current' : ''}>
            <button className="diff-open" onClick={() => { void ed.switchDifficulty(i); ed.openDialog(null); }}>
              <b>{d.beatmap.metadata.version}</b>
              <span className="muted"> · {['osu!', 'taiko', 'catch', 'mania'][d.beatmap.general.mode]} · {d.beatmap.hitObjects.length} objects</span>
            </button>
            <button
              className="danger small"
              disabled={p.difficulties.length <= 1}
              onClick={() => confirm(`Delete difficulty "${d.beatmap.metadata.version}"?`) && ed.deleteDifficulty(i)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function NewDifficultyDialog() {
  const ed = useEditor();
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(false);
  const [mode, setMode] = useState(ed.bm.general.mode);
  return (
    <Modal
      title="Create new difficulty"
      footer={
        <>
          <button onClick={() => ed.openDialog(null)}>Cancel</button>
          <button className="primary" onClick={() => { ed.addDifficulty(name.trim(), { copyObjects: copy, mode }); ed.openDialog(null); }}>Create</button>
        </>
      }
    >
      <Field label="Difficulty name"><input autoFocus value={name} placeholder="Insane" onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Game mode">
        <select value={mode} onChange={(e) => setMode(Number(e.target.value) as typeof mode)}>
          <option value={0}>osu!</option>
          <option value={1}>osu!taiko</option>
          <option value={2}>osu!catch</option>
          <option value={3}>osu!mania</option>
        </select>
      </Field>
      <Field label="Copy hit objects from current difficulty" hint="Timing (red lines) and song setup are always copied">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
      </Field>
    </Modal>
  );
}

export function PreferencesDialog() {
  const ed = useEditor();
  const p = ed.prefs;
  return (
    <Modal title="Preferences" footer={<button className="primary" onClick={() => ed.openDialog(null)}>Done</button>}>
      <SliderField label="Music volume" value={p.musicVolume} min={0} max={1} step={0.01} onChange={(v) => ed.setPrefs({ musicVolume: v })} />
      <SliderField label="Hitsound volume" value={p.hitsoundVolume} min={0} max={1} step={0.01} onChange={(v) => ed.setPrefs({ hitsoundVolume: v })} />
      <SliderField label="Audio offset (ms)" value={p.audioOffset} min={-200} max={200} step={1} onChange={(v) => ed.setPrefs({ audioOffset: v })} hint="Positive if hitsounds play too early compared to the music" />
      <SliderField label="Background dim" value={p.backgroundDim} min={0} max={1} step={0.05} onChange={(v) => ed.setPrefs({ backgroundDim: v })} />
      <Field label="Hit animations"><input type="checkbox" checked={p.showHitAnimations} onChange={(e) => ed.setPrefs({ showHitAnimations: e.target.checked })} /></Field>
      <Field label="Follow points"><input type="checkbox" checked={p.showFollowPoints} onChange={(e) => ed.setPrefs({ showFollowPoints: e.target.checked })} /></Field>
      <Field label="Snaking sliders"><input type="checkbox" checked={p.snakingSliders} onChange={(e) => ed.setPrefs({ snakingSliders: e.target.checked })} /></Field>
      <Field label="Timeline waveform"><input type="checkbox" checked={p.showWaveform} onChange={(e) => ed.setPrefs({ showWaveform: e.target.checked })} /></Field>
      <Field label="Show storyboard"><input type="checkbox" checked={p.showStoryboard} onChange={(e) => ed.setPrefs({ showStoryboard: e.target.checked })} /></Field>
      <Field label="Show background video"><input type="checkbox" checked={p.showVideo} onChange={(e) => ed.setPrefs({ showVideo: e.target.checked })} /></Field>
      <Field label="Invert mouse wheel seeking"><input type="checkbox" checked={p.invertScroll} onChange={(e) => ed.setPrefs({ invertScroll: e.target.checked })} /></Field>
      <Field label="Creator name (when not logged in)"><input value={p.creatorName} onChange={(e) => ed.setPrefs({ creatorName: e.target.value })} /></Field>
    </Modal>
  );
}

export function FilesDialog() {
  const ed = useEditor();
  const files = [...ed.project!.files.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <Modal title="Beatmap folder" footer={<button className="primary" onClick={() => ed.openDialog(null)}>Done</button>}>
      <table className="file-table">
        <tbody>
          {files.map(([name, blob]) => (
            <tr key={name}>
              <td className="mono">{name}</td>
              <td className="muted">{(blob.size / 1024).toFixed(0)} KB</td>
              <td>
                <button
                  className="danger small"
                  onClick={() => {
                    if (name === ed.bm.general.audioFilename) return editor.toast('This is the audio file; replace it from Song Setup instead.', 'error');
                    if (confirm(`Remove ${name}?`)) ed.setFile(name, null);
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
