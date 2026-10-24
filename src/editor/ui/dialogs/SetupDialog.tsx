import { useMemo, useState } from 'react';
import { hitsounds } from '../../../audio/hitsounds';
import { music } from '../../../audio/music';
import { cloud } from '../../../project/cloud';
import { pickFiles } from '../../../project/open';
import { cloneBeatmap } from '../../../project/project';
import { DEFAULT_COMBO_COLOURS, type Beatmap, type GameMode, type Rgb, type SampleSetName } from '../../../osu/types';
import { Check, GroupBox, NumberBox, OkCancel, Radio, Row, TrackRow, WinDialog, WinTabs } from '../../../ui/win';
import { formatTimestamp, useEditor } from '../../store';

const TABS = ['General', 'Difficulty', 'Audio', 'Colours', 'Design', 'Advanced'] as const;
type Tab = (typeof TABS)[number];

const hex = (c: Rgb) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): Rgb => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** Metadata that is the same for every difficulty of a set, like stable. */
const SHARED_METADATA = ['artist', 'artistUnicode', 'title', 'titleUnicode', 'creator', 'source', 'tags'] as const;
const DIFFICULTY_NAMES = ['Easy', 'Normal', 'Hard', 'Insane', 'Expert', 'Extra', 'Extreme', 'Kantan', 'Futsuu', 'Muzukashii', 'Oni', 'Inner Oni', 'Cup', 'Salad', 'Platter', 'Rain', 'Overdose', 'Beginner', 'Advanced', 'Hyper', 'Another'];

/**
 * F4 Song Setup. Changes are made on a copy and applied with OK, like stable. For File → Create a new
 * Difficulty it edits the new difficulty instead, and needs a difficulty name before OK is enabled.
 */
export function SetupDialog() {
  const ed = useEditor();
  const newDiff = ed.pendingNewDifficulty;
  const [tab, setTab] = useState<Tab>('General');
  const [draft, setDraft] = useState<Beatmap>(() => cloneBeatmap(newDiff ?? ed.bm));
  const [pendingFiles] = useState(() => new Map<string, Blob>());
  const set = (fn: (b: Beatmap) => void) =>
    setDraft((d) => {
      const n = cloneBeatmap(d);
      fn(n);
      return n;
    });
  const m = draft.metadata;
  const g = draft.general;
  const d = draft.difficulty;
  const mode = g.mode;
  const loggedIn = !!cloud.user;

  const close = () => {
    ed.pendingNewDifficulty = null;
    ed.openDialog(null);
  };

  const ok = async () => {
    for (const [name, blob] of pendingFiles) ed.setFile(name, blob);
    const apply = (target: Beatmap) => {
      target.metadata = { ...draft.metadata };
      target.general = { ...draft.general, audioFilename: target.general.audioFilename };
      target.difficulty = { ...target.difficulty, hpDrainRate: d.hpDrainRate, circleSize: d.circleSize, approachRate: d.approachRate, overallDifficulty: d.overallDifficulty };
      target.colours = structuredClone(draft.colours);
      target.events.background = draft.events.background;
      target.events.video = draft.events.video;
      target.timingPoints = structuredClone(draft.timingPoints);
    };
    if (newDiff) {
      apply(newDiff);
      ed.openDialog(null);
      await ed.commitNewDifficulty();
      return;
    }
    ed.commit(apply);
    // Shared metadata and the background follow to the other difficulties.
    for (const diff of ed.project!.difficulties) {
      if (diff.beatmap === ed.bm) continue;
      for (const k of SHARED_METADATA) (diff.beatmap.metadata as unknown as Record<string, unknown>)[k] = draft.metadata[k];
      diff.beatmap.events.background = draft.events.background;
    }
    ed.openDialog(null);
  };

  const pickImage = async () => {
    const [f] = await pickFiles('image/*');
    if (!f) return;
    pendingFiles.set(f.name, f);
    set((b) => (b.events.background = { filename: f.name, x: 0, y: 0 }));
  };
  const pickVideo = async () => {
    const [f] = await pickFiles('video/*,.avi,.flv,.mp4');
    if (!f) return;
    pendingFiles.set(f.name, f);
    set((b) => (b.events.video = { filename: f.name, startTime: 0, x: 0, y: 0 }));
  };

  // Audio tab: one volume / custom index for the whole map, unless timing sections already vary.
  const tps = draft.timingPoints;
  const uniform = useMemo(() => tps.every((t) => t.volume === tps[0].volume && t.sampleIndex === tps[0].sampleIndex && t.sampleSet === tps[0].sampleSet), [tps]);
  const volume = tps[0]?.volume ?? 100;
  const customIndex = tps[0]?.sampleIndex ?? 0;

  const preview = (bits: number) => {
    const s = g.sampleSet === 'Normal' ? 1 : g.sampleSet === 'Drum' ? 3 : 2;
    hitsounds.playHit(draft, music.time, bits, s as 1 | 2 | 3, s as 1 | 2 | 3, customIndex, volume);
  };

  return (
    <WinDialog title="Song Setup" onClose={close} width={460} footer={<OkCancel onOk={() => void ok()} onCancel={close} okDisabled={!m.version.trim()} />}>
      <WinTabs tabs={TABS} value={tab} onChange={setTab}>
        {tab === 'General' && (
          <>
            <GroupBox title="Song and Map Metadata">
              <Row label="Artist" dim={!!newDiff}>
                <input value={m.artistUnicode} disabled={!!newDiff} onChange={(e) => set((b) => { b.metadata.artistUnicode = e.target.value; if (isAscii(e.target.value)) b.metadata.artist = e.target.value; })} />
              </Row>
              <Row label="Romanised Artist" dim={!!newDiff || isAscii(m.artistUnicode)}>
                <input value={m.artist} disabled={!!newDiff || isAscii(m.artistUnicode)} onChange={(e) => set((b) => (b.metadata.artist = e.target.value))} />
              </Row>
              <Row label="Title" dim={!!newDiff}>
                <input value={m.titleUnicode} disabled={!!newDiff} onChange={(e) => set((b) => { b.metadata.titleUnicode = e.target.value; if (isAscii(e.target.value)) b.metadata.title = e.target.value; })} />
              </Row>
              <Row label="Romanised Title" dim={!!newDiff || isAscii(m.titleUnicode)}>
                <input value={m.title} disabled={!!newDiff || isAscii(m.titleUnicode)} onChange={(e) => set((b) => (b.metadata.title = e.target.value))} />
              </Row>
              <Row label="Beatmap Creator" dim={loggedIn || !!newDiff} hint={loggedIn ? 'Your osu! username' : undefined}>
                <input value={m.creator} disabled={loggedIn || !!newDiff} onChange={(e) => set((b) => (b.metadata.creator = e.target.value))} />
              </Row>
              <Row label="Difficulty">
                <input list="diff-names" value={m.version} autoFocus={!!newDiff} onChange={(e) => set((b) => (b.metadata.version = e.target.value))} />
                <datalist id="diff-names">{DIFFICULTY_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
              </Row>
              <Row label="Source"><input value={m.source} onChange={(e) => set((b) => (b.metadata.source = e.target.value))} /></Row>
              <Row label="Tags"><input value={m.tags} onChange={(e) => set((b) => (b.metadata.tags = e.target.value))} /></Row>
            </GroupBox>
            <GroupBox title="A quick note">
              <p className="win-note">
                Lots of beatmaps get submitted, so the bar for getting one ranked is high. Make sure yours is at least timed properly, or it will likely be ignored!
              </p>
              <div className="win-links">
                <a href="https://osu.ppy.sh/wiki/Client/Beatmap_editor" target="_blank" rel="noreferrer">Editor Guide/FAQ</a>
                <a href="https://osu.ppy.sh/wiki/Ranking_criteria" target="_blank" rel="noreferrer">Official Submission Criteria</a>
              </div>
            </GroupBox>
          </>
        )}

        {tab === 'Difficulty' && (
          <GroupBox title="Difficulty">
            <TrackRow label="HP Drain Rate" left="Easy" right="Hard" value={d.hpDrainRate} min={0} max={10} step={0.1} onChange={(v) => set((b) => (b.difficulty.hpDrainRate = v))} />
            {mode === 3 ? (
              <TrackRow label="Key Count" value={Math.round(d.circleSize)} min={1} max={18} step={1} onChange={(v) => set((b) => (b.difficulty.circleSize = v))} />
            ) : (
              <TrackRow label="Circle Size" left="Large" right="Small" value={d.circleSize} min={0} max={10} step={0.1} disabled={mode === 1} onChange={(v) => set((b) => (b.difficulty.circleSize = v))} />
            )}
            <TrackRow label="Approach Rate" left="Slow" right="Fast" value={d.approachRate} min={0} max={10} step={0.1} disabled={mode === 1 || mode === 3} onChange={(v) => set((b) => (b.difficulty.approachRate = v))} />
            <TrackRow label="Overall Difficulty" left="Easy" right="Insane" value={d.overallDifficulty} min={0} max={10} step={0.1} onChange={(v) => set((b) => (b.difficulty.overallDifficulty = v))} />
          </GroupBox>
        )}

        {tab === 'Audio' && (
          <>
            <GroupBox title="Default Sampleset">
              {(['Normal', 'Soft', 'Drum'] as SampleSetName[]).map((s) => (
                <Radio key={s} name="sampleset" label={s} checked={g.sampleSet === s} onChange={() => set((b) => (b.general.sampleSet = s))} />
              ))}
              <div className="win-buttonrow">
                <button onClick={() => preview(0)}>Normal</button>
                <button onClick={() => preview(2)}>Whistle</button>
                <button onClick={() => preview(4)}>Finish</button>
                <button onClick={() => preview(8)}>Clap</button>
              </div>
            </GroupBox>
            <GroupBox title="Sample settings">
              {!uniform && <p className="win-muted">Timing sections have their own volume or custom samples. Reset them to edit the settings for the whole map.</p>}
              <Check label="Enable custom overrides" disabled={!uniform || !tps.length} checked={customIndex > 0} onChange={(v) => set((b) => b.timingPoints.forEach((t) => (t.sampleIndex = v ? 1 : 0)))} />
              <TrackRow label="Sample Volume" value={volume} min={5} max={100} step={1} disabled={!uniform || !tps.length} onChange={(v) => set((b) => b.timingPoints.forEach((t) => (t.volume = Math.round(v))))} />
              <button disabled={uniform} onClick={() => set((b) => b.timingPoints.forEach((t) => { t.volume = volume; t.sampleIndex = customIndex; t.sampleSet = 0; }))}>Reset Settings</button>
            </GroupBox>
            <GroupBox title="Misc.">
              <Check label="Samples match playback rate" checked={g.samplesMatchPlaybackRate} onChange={(v) => set((b) => (b.general.samplesMatchPlaybackRate = v))} />
              <Row label="Audio file">
                <span className="win-mono">{g.audioFilename}</span>
                <button onClick={async () => { const [f] = await pickFiles('audio/*,.mp3,.ogg'); if (f) await ed.replaceAudio(f); }}>Replace...</button>
              </Row>
              <Row label="Preview point">
                <span className="win-mono">{g.previewTime >= 0 ? formatTimestamp(g.previewTime) : 'not set'}</span>
                <button onClick={() => set((b) => (b.general.previewTime = Math.round(music.time)))}>Use Current Time</button>
              </Row>
            </GroupBox>
          </>
        )}

        {tab === 'Colours' && (
          <>
            <GroupBox title="Combo Colours">
              <Check label="Enable Custom Colours" checked={draft.colours.combo.length > 0} onChange={(v) => set((b) => (b.colours.combo = v ? DEFAULT_COMBO_COLOURS.map((c) => ({ ...c })) : []))} />
              <div className="win-colours">
                {draft.colours.combo.map((c, i) => (
                  <label key={i} className="win-colour">
                    <input type="color" value={hex(c)} onChange={(e) => set((b) => (b.colours.combo[i] = fromHex(e.target.value)))} />
                    Combo {i + 1}
                  </label>
                ))}
              </div>
              <div className="win-buttonrow">
                <button disabled={!draft.colours.combo.length || draft.colours.combo.length >= 8} onClick={() => set((b) => b.colours.combo.push({ r: 255, g: 255, b: 255 }))}>New Combo Colour</button>
                <button disabled={draft.colours.combo.length <= 2} onClick={() => set((b) => b.colours.combo.pop())}>Remove Combo Colour</button>
              </div>
            </GroupBox>
            <GroupBox title="Sliders">
              <Check label="Custom slider border" checked={!!draft.colours.sliderBorder} onChange={(v) => set((b) => (b.colours.sliderBorder = v ? { r: 255, g: 255, b: 255 } : null))} />
              {draft.colours.sliderBorder && <input type="color" value={hex(draft.colours.sliderBorder)} onChange={(e) => set((b) => (b.colours.sliderBorder = fromHex(e.target.value)))} />}
              <br />
              <Check label="Custom slider track" checked={!!draft.colours.sliderTrackOverride} onChange={(v) => set((b) => (b.colours.sliderTrackOverride = v ? { r: 0, g: 0, b: 0 } : null))} />
              {draft.colours.sliderTrackOverride && <input type="color" value={hex(draft.colours.sliderTrackOverride)} onChange={(e) => set((b) => (b.colours.sliderTrackOverride = fromHex(e.target.value)))} />}
            </GroupBox>
          </>
        )}

        {tab === 'Design' && (
          <>
            <GroupBox title="Countdown">
              <Check label="Enable countdown" checked={g.countdown > 0} onChange={(v) => set((b) => (b.general.countdown = v ? 1 : 0))} />
              <div>
                {[['Half', 2], ['Normal', 1], ['Double', 3]].map(([label, v]) => (
                  <Radio key={label} name="cdspeed" label={String(label)} disabled={g.countdown === 0} checked={g.countdown === v} onChange={() => set((b) => (b.general.countdown = Number(v)))} />
                ))}
              </div>
              <Row label="Countdown Offset" dim={g.countdown === 0}>
                <NumberBox value={g.countdownOffset} min={0} max={3} step={1} disabled={g.countdown === 0} onChange={(v) => set((b) => (b.general.countdownOffset = Math.round(v)))} />
                <span className="win-muted">beats earlier</span>
              </Row>
            </GroupBox>
            <GroupBox title="Misc. Toggles">
              <Check label="Widescreen Support" checked={g.widescreenStoryboard} onChange={(v) => set((b) => (b.general.widescreenStoryboard = v))} /><br />
              <Check label="Display epilepsy warning" checked={g.epilepsyWarning} onChange={(v) => set((b) => (b.general.epilepsyWarning = v))} /><br />
              <Check label="Letterbox during breaks" checked={g.letterboxInBreaks} disabled={mode === 3} onChange={(v) => set((b) => (b.general.letterboxInBreaks = v))} /><br />
              <Check label="Use skin sprites in storyboard" checked={g.useSkinSprites} onChange={(v) => set((b) => (b.general.useSkinSprites = v))} />
              <Row label="Preferred skin"><input value={g.skinPreference} placeholder="(none)" onChange={(e) => set((b) => (b.general.skinPreference = e.target.value))} /></Row>
            </GroupBox>
            <GroupBox title="Background">
              <Row label="Image"><span className="win-mono">{draft.events.background?.filename ?? 'none'}</span><button onClick={() => void pickImage()}>Browse...</button></Row>
              <Row label="Video">
                <span className="win-mono">{draft.events.video?.filename ?? 'none'}</span>
                <button onClick={() => void pickVideo()}>Browse...</button>
                {draft.events.video && <button onClick={() => set((b) => (b.events.video = null))}>Remove</button>}
              </Row>
              {draft.events.video && (
                <Row label="Video offset (ms)"><NumberBox value={draft.events.video.startTime} step={10} width={80} onChange={(v) => set((b) => b.events.video && (b.events.video.startTime = Math.round(v)))} /></Row>
              )}
            </GroupBox>
          </>
        )}

        {tab === 'Advanced' && (
          <>
            <GroupBox title="Misc.">
              <TrackRow label="Stack Leniency" left="Less" right="More" value={g.stackLeniency} min={0.2} max={1} step={0.1} disabled={mode !== 0} onChange={(v) => set((b) => (b.general.stackLeniency = Math.round(v * 10) / 10))} />
              <Row label="Allowed Modes">
                <select value={mode} onChange={(e) => set((b) => (b.general.mode = Number(e.target.value) as GameMode))}>
                  <option value={0}>All</option>
                  <option value={1}>Taiko</option>
                  <option value={2}>Catch the Beat</option>
                  <option value={3}>osu!mania</option>
                </select>
              </Row>
              <Check label="Use special style (N+1 style) for mania" checked={g.specialStyle} disabled={mode !== 3} onChange={(v) => set((b) => (b.general.specialStyle = v))} />
              <Row label="Audio lead-in (ms)"><NumberBox value={g.audioLeadIn} min={0} step={100} width={80} onChange={(v) => set((b) => (b.general.audioLeadIn = Math.round(v)))} /></Row>
            </GroupBox>
            <GroupBox title="Online">
              <Row label="Beatmap ID"><span className="win-mono">{m.beatmapId || '—'}</span></Row>
              <Row label="Beatmap Set ID"><span className="win-mono">{m.beatmapSetId > 0 ? m.beatmapSetId : '—'}</span></Row>
            </GroupBox>
          </>
        )}
      </WinTabs>
    </WinDialog>
  );
}
