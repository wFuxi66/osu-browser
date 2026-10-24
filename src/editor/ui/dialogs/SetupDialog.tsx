import { useState } from 'react';
import { music } from '../../../audio/music';
import { circleRadius, preemptTime, hitWindows } from '../../../osu/processing';
import { DEFAULT_COMBO_COLOURS, MODE_NAMES, type Beatmap, type GameMode, type Rgb, type SampleSetName } from '../../../osu/types';
import { formatTimestamp, useEditor } from '../../store';
import { Field, Modal, SliderField } from './Modal';

const TABS = ['General', 'Difficulty', 'Audio', 'Colours', 'Design', 'Advanced'] as const;

const hex = (c: Rgb) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): Rgb => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

/** Metadata changes apply to every difficulty in the set, like stable. */
const SHARED_METADATA = ['artist', 'artistUnicode', 'title', 'titleUnicode', 'creator', 'source', 'tags'] as const;

export function SetupDialog() {
  const ed = useEditor();
  const [tab, setTab] = useState<(typeof TABS)[number]>('General');
  const bm = ed.bm;
  const m = bm.metadata;
  const d = bm.difficulty;
  const g = bm.general;
  const set = (fn: (b: Beatmap) => void) => ed.commit(fn);

  const setMeta = (key: keyof Beatmap['metadata'], value: string) => {
    set((b) => {
      (b.metadata as unknown as Record<string, unknown>)[key] = value;
    });
    if ((SHARED_METADATA as readonly string[]).includes(key)) {
      for (const diff of ed.project!.difficulties) (diff.beatmap.metadata as unknown as Record<string, unknown>)[key] = value;
    }
  };

  const pickImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      ed.setFile(f.name, f);
      for (const diff of ed.project!.difficulties) diff.beatmap.events.background = { filename: f.name, x: 0, y: 0 };
      ed.markDirty();
    };
    input.click();
  };

  const pickVideo = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,.avi,.flv,.mp4';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      ed.setFile(f.name, f);
      set((b) => (b.events.video = { filename: f.name, startTime: 0, x: 0, y: 0 }));
    };
    input.click();
  };

  const isMania = g.mode === 3;
  const isTaiko = g.mode === 1;

  return (
    <Modal title="Song Setup" wide footer={<button className="primary" onClick={() => ed.openDialog(null)}>Done</button>}>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'General' && (
          <>
            <Field label="Artist"><input value={m.artistUnicode} onChange={(e) => setMeta('artistUnicode', e.target.value)} /></Field>
            <Field label="Romanised artist" hint="ASCII only"><input value={m.artist} onChange={(e) => setMeta('artist', e.target.value)} /></Field>
            <Field label="Title"><input value={m.titleUnicode} onChange={(e) => setMeta('titleUnicode', e.target.value)} /></Field>
            <Field label="Romanised title" hint="ASCII only"><input value={m.title} onChange={(e) => setMeta('title', e.target.value)} /></Field>
            <Field label="Beatmap creator"><input value={m.creator} onChange={(e) => setMeta('creator', e.target.value)} /></Field>
            <Field label="Difficulty"><input value={m.version} onChange={(e) => setMeta('version', e.target.value)} /></Field>
            <Field label="Source"><input value={m.source} onChange={(e) => setMeta('source', e.target.value)} /></Field>
            <Field label="Tags" hint="Space-separated"><textarea rows={3} value={m.tags} onChange={(e) => setMeta('tags', e.target.value)} /></Field>
          </>
        )}
        {tab === 'Difficulty' && (
          <>
            <SliderField label="HP drain rate" value={d.hpDrainRate} min={0} max={10} step={0.1} onChange={(v) => set((b) => (b.difficulty.hpDrainRate = v))} />
            {isMania ? (
              <SliderField label="Key count" value={d.circleSize} min={1} max={18} step={1} onChange={(v) => set((b) => (b.difficulty.circleSize = v))} />
            ) : (
              !isTaiko && <SliderField label="Circle size" value={d.circleSize} min={0} max={10} step={0.1} onChange={(v) => set((b) => (b.difficulty.circleSize = v))} hint={`radius ${circleRadius(d.circleSize).toFixed(1)}px`} />
            )}
            {!isMania && !isTaiko && (
              <SliderField label="Approach rate" value={d.approachRate} min={0} max={10} step={0.1} onChange={(v) => set((b) => (b.difficulty.approachRate = v))} hint={`${Math.round(preemptTime(d.approachRate))}ms preempt`} />
            )}
            <SliderField label="Overall difficulty" value={d.overallDifficulty} min={0} max={10} step={0.1} onChange={(v) => set((b) => (b.difficulty.overallDifficulty = v))} hint={(() => { const w = hitWindows(d.overallDifficulty); return `300: ±${w.great.toFixed(0)}ms · 100: ±${w.ok.toFixed(0)}ms · 50: ±${w.meh.toFixed(0)}ms`; })()} />
            <SliderField label="Slider velocity" value={d.sliderMultiplier} min={0.4} max={3.6} step={0.01} onChange={(v) => set((b) => (b.difficulty.sliderMultiplier = v))} hint="Base slider multiplier (changes existing slider durations)" />
            <Field label="Slider tick rate">
              <select value={d.sliderTickRate} onChange={(e) => set((b) => (b.difficulty.sliderTickRate = Number(e.target.value)))}>
                {[0.5, 1, 2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                {![0.5, 1, 2, 3, 4, 6, 8].includes(d.sliderTickRate) && <option value={d.sliderTickRate}>{d.sliderTickRate}</option>}
              </select>
            </Field>
          </>
        )}
        {tab === 'Audio' && (
          <>
            <Field label="Audio file">
              <span className="mono">{g.audioFilename}</span>
              <button
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'audio/*,.mp3,.ogg';
                  input.onchange = () => input.files?.[0] && void ed.replaceAudio(input.files[0]);
                  input.click();
                }}
              >
                Replace…
              </button>
            </Field>
            <Field label="Default sample set">
              <select value={g.sampleSet} onChange={(e) => set((b) => (b.general.sampleSet = e.target.value as SampleSetName))}>
                {['Normal', 'Soft', 'Drum'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Audio lead-in" hint="ms of silence before the song starts">
              <input type="number" step={100} value={g.audioLeadIn} onChange={(e) => set((b) => (b.general.audioLeadIn = Number(e.target.value)))} />
            </Field>
            <Field label="Preview point" hint="Where song select starts playing">
              <span className="mono">{g.previewTime >= 0 ? formatTimestamp(g.previewTime) : 'not set'}</span>
              <button onClick={() => set((b) => (b.general.previewTime = Math.round(music.time)))}>Use current time</button>
              <button onClick={() => set((b) => (b.general.previewTime = -1))}>Clear</button>
            </Field>
            <Field label="Samples match playback rate">
              <input type="checkbox" checked={g.samplesMatchPlaybackRate} onChange={(e) => set((b) => (b.general.samplesMatchPlaybackRate = e.target.checked))} />
            </Field>
            <Field label="Background image">
              <span className="mono">{bm.events.background?.filename ?? 'none'}</span>
              <button onClick={pickImage}>Choose…</button>
            </Field>
            <Field label="Video">
              <span className="mono">{bm.events.video?.filename ?? 'none'}</span>
              <button onClick={pickVideo}>Choose…</button>
              {bm.events.video && (
                <>
                  <input type="number" title="Start offset (ms)" value={bm.events.video.startTime} onChange={(e) => set((b) => b.events.video && (b.events.video.startTime = Number(e.target.value)))} />
                  <button onClick={() => set((b) => (b.events.video = null))}>Remove</button>
                </>
              )}
            </Field>
          </>
        )}
        {tab === 'Colours' && (
          <>
            <div className="colour-grid">
              {bm.colours.combo.map((c, i) => (
                <div key={i} className="colour-item">
                  <span>Combo {i + 1}</span>
                  <input type="color" value={hex(c)} onChange={(e) => set((b) => (b.colours.combo[i] = fromHex(e.target.value)))} />
                  <button className="small" onClick={() => set((b) => b.colours.combo.splice(i, 1))} disabled={bm.colours.combo.length <= 2}>✕</button>
                </div>
              ))}
            </div>
            <div className="row">
              <button onClick={() => set((b) => b.colours.combo.push({ r: 255, g: 255, b: 255 }))} disabled={bm.colours.combo.length >= 8}>Add colour</button>
              <button onClick={() => set((b) => (b.colours.combo = DEFAULT_COMBO_COLOURS.map((c) => ({ ...c }))))}>Reset to default</button>
              <button onClick={() => set((b) => (b.colours.combo = []))}>Use skin colours</button>
            </div>
            <Field label="Slider border">
              <input type="checkbox" checked={!!bm.colours.sliderBorder} onChange={(e) => set((b) => (b.colours.sliderBorder = e.target.checked ? { r: 255, g: 255, b: 255 } : null))} />
              {bm.colours.sliderBorder && <input type="color" value={hex(bm.colours.sliderBorder)} onChange={(e) => set((b) => (b.colours.sliderBorder = fromHex(e.target.value)))} />}
            </Field>
            <Field label="Slider track override">
              <input type="checkbox" checked={!!bm.colours.sliderTrackOverride} onChange={(e) => set((b) => (b.colours.sliderTrackOverride = e.target.checked ? { r: 0, g: 0, b: 0 } : null))} />
              {bm.colours.sliderTrackOverride && <input type="color" value={hex(bm.colours.sliderTrackOverride)} onChange={(e) => set((b) => (b.colours.sliderTrackOverride = fromHex(e.target.value)))} />}
            </Field>
          </>
        )}
        {tab === 'Design' && (
          <>
            <Field label="Countdown">
              <select value={g.countdown} onChange={(e) => set((b) => (b.general.countdown = Number(e.target.value)))}>
                <option value={0}>No countdown</option>
                <option value={1}>Normal</option>
                <option value={2}>Half</option>
                <option value={3}>Double</option>
              </select>
            </Field>
            <Field label="Countdown offset" hint="in beats">
              <input type="number" min={0} max={3} value={g.countdownOffset} onChange={(e) => set((b) => (b.general.countdownOffset = Number(e.target.value)))} />
            </Field>
            <Field label="Letterbox during breaks"><input type="checkbox" checked={g.letterboxInBreaks} onChange={(e) => set((b) => (b.general.letterboxInBreaks = e.target.checked))} /></Field>
            <Field label="Widescreen storyboard"><input type="checkbox" checked={g.widescreenStoryboard} onChange={(e) => set((b) => (b.general.widescreenStoryboard = e.target.checked))} /></Field>
            <Field label="Epilepsy warning"><input type="checkbox" checked={g.epilepsyWarning} onChange={(e) => set((b) => (b.general.epilepsyWarning = e.target.checked))} /></Field>
            <Field label="Use skin sprites in storyboard"><input type="checkbox" checked={g.useSkinSprites} onChange={(e) => set((b) => (b.general.useSkinSprites = e.target.checked))} /></Field>
            {g.mode === 0 && <SliderField label="Stack leniency" value={g.stackLeniency} min={0.2} max={1} step={0.1} onChange={(v) => set((b) => (b.general.stackLeniency = v))} />}
            {isMania && <Field label="Special style (N+1)"><input type="checkbox" checked={g.specialStyle} onChange={(e) => set((b) => (b.general.specialStyle = e.target.checked))} /></Field>}
          </>
        )}
        {tab === 'Advanced' && (
          <>
            <Field label="Game mode" hint="Changing the mode keeps objects; mania uses columns from x positions.">
              <select value={g.mode} onChange={(e) => set((b) => (b.general.mode = Number(e.target.value) as GameMode))}>
                {MODE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
            </Field>
            <Field label="Beatmap ID"><span className="mono">{m.beatmapId || '—'}</span></Field>
            <Field label="Beatmapset ID"><span className="mono">{m.beatmapSetId > 0 ? m.beatmapSetId : '—'}</span></Field>
            <Field label="Skin preference"><input value={g.skinPreference} onChange={(e) => set((b) => (b.general.skinPreference = e.target.value))} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
