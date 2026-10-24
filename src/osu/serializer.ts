import { SAMPLE_SET_NAMES, type Beatmap, type HitObject, type HitSample, type Rgb } from './types';

function n(v: number): string {
  if (Number.isInteger(v)) return String(v);
  // Avoid float noise such as 0.30000000000000004 while keeping precision.
  return String(Number(v.toPrecision(15)));
}

function b(v: boolean): string {
  return v ? '1' : '0';
}

function rgb(c: Rgb): string {
  return `${c.r},${c.g},${c.b}`;
}

function sampleStr(s: HitSample): string {
  return `${s.normalSet}:${s.additionSet}:${s.index}:${s.volume}:${s.filename}`;
}

export function serializeHitObject(o: HitObject, mode: number): string {
  let type = 0;
  if (o.newCombo) type |= 4;
  type |= (o.comboSkip & 7) << 4;
  const x = Math.round(o.x);
  const y = Math.round(o.y);
  const head = (t: number) => `${x},${y},${Math.round(o.time)},${type | t},${o.hitSound}`;
  switch (o.kind) {
    case 'circle':
      return `${head(1)},${sampleStr(o.sample)}`;
    case 'slider': {
      const pts = o.points.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`).join('|');
      const edgeSounds = o.edgeSounds.slice(0, o.slides + 1);
      while (edgeSounds.length < o.slides + 1) edgeSounds.push(0);
      const edgeSets = o.edgeSets.slice(0, o.slides + 1);
      while (edgeSets.length < o.slides + 1) edgeSets.push({ normal: 0, addition: 0 });
      return [
        head(2),
        `${o.curveType}|${pts}`,
        o.slides,
        n(o.length),
        edgeSounds.join('|'),
        edgeSets.map((e) => `${e.normal}:${e.addition}`).join('|'),
        sampleStr(o.sample),
      ].join(',');
    }
    case 'spinner':
      // Spinners are always centered in osu!.
      return `${mode === 0 ? '256,192' : `${x},${y}`},${Math.round(o.time)},${type | 8},${o.hitSound},${Math.round(o.endTime)},${sampleStr(o.sample)}`;
    case 'hold':
      return `${head(128)},${Math.round(o.endTime)}:${sampleStr(o.sample)}`;
  }
}

/** Storyboard objects grouped by layer so they serialize under the right header. */
function groupStoryboard(lines: string[]) {
  const layers: Record<string, string[]> = { Background: [], Fail: [], Pass: [], Foreground: [], Overlay: [], Samples: [], Other: [] };
  let current: string[] = layers.Other;
  for (const line of lines) {
    if (/^[ _]/.test(line)) {
      current.push(line);
      continue;
    }
    const p = line.split(',');
    const kind = p[0].trim();
    let layer = 'Other';
    if (kind === 'Sprite' || kind === '4' || kind === 'Animation' || kind === '6') {
      const l = p[1]?.trim();
      layer = ({ '0': 'Background', '1': 'Fail', '2': 'Pass', '3': 'Foreground', '4': 'Overlay' } as Record<string, string>)[l] ?? l;
      if (!(layer in layers)) layer = 'Other';
    } else if (kind === 'Sample' || kind === '5') {
      layer = 'Samples';
    }
    current = layers[layer];
    current.push(line);
  }
  return layers;
}

export function serializeBeatmap(bm: Beatmap): string {
  const out: string[] = [];
  const g = bm.general;
  out.push('osu file format v14', '');
  out.push('[General]');
  out.push(`AudioFilename: ${g.audioFilename}`);
  out.push(`AudioLeadIn: ${g.audioLeadIn}`);
  out.push(`PreviewTime: ${g.previewTime}`);
  out.push(`Countdown: ${g.countdown}`);
  out.push(`SampleSet: ${g.sampleSet}`);
  out.push(`StackLeniency: ${n(g.stackLeniency)}`);
  out.push(`Mode: ${g.mode}`);
  out.push(`LetterboxInBreaks: ${b(g.letterboxInBreaks)}`);
  if (g.useSkinSprites) out.push('UseSkinSprites: 1');
  if (g.overlayPosition && g.overlayPosition !== 'NoChange') out.push(`OverlayPosition: ${g.overlayPosition}`);
  if (g.skinPreference) out.push(`SkinPreference: ${g.skinPreference}`);
  if (g.epilepsyWarning) out.push('EpilepsyWarning: 1');
  if (g.countdownOffset) out.push(`CountdownOffset: ${g.countdownOffset}`);
  if (g.mode === 3) out.push(`SpecialStyle: ${b(g.specialStyle)}`);
  out.push(`WidescreenStoryboard: ${b(g.widescreenStoryboard)}`);
  if (g.samplesMatchPlaybackRate) out.push('SamplesMatchPlaybackRate: 1');
  out.push('');

  const e = bm.editor;
  out.push('[Editor]');
  if (e.bookmarks.length) out.push(`Bookmarks: ${e.bookmarks.map((t) => Math.round(t)).join(',')}`);
  out.push(`DistanceSpacing: ${n(e.distanceSpacing)}`);
  out.push(`BeatDivisor: ${e.beatDivisor}`);
  out.push(`GridSize: ${e.gridSize}`);
  out.push(`TimelineZoom: ${n(e.timelineZoom)}`);
  out.push('');

  const m = bm.metadata;
  out.push('[Metadata]');
  out.push(`Title:${m.title}`);
  out.push(`TitleUnicode:${m.titleUnicode}`);
  out.push(`Artist:${m.artist}`);
  out.push(`ArtistUnicode:${m.artistUnicode}`);
  out.push(`Creator:${m.creator}`);
  out.push(`Version:${m.version}`);
  out.push(`Source:${m.source}`);
  out.push(`Tags:${m.tags}`);
  out.push(`BeatmapID:${m.beatmapId}`);
  out.push(`BeatmapSetID:${m.beatmapSetId}`);
  out.push('');

  const d = bm.difficulty;
  out.push('[Difficulty]');
  out.push(`HPDrainRate:${n(d.hpDrainRate)}`);
  out.push(`CircleSize:${n(d.circleSize)}`);
  out.push(`OverallDifficulty:${n(d.overallDifficulty)}`);
  out.push(`ApproachRate:${n(d.approachRate)}`);
  out.push(`SliderMultiplier:${n(d.sliderMultiplier)}`);
  out.push(`SliderTickRate:${n(d.sliderTickRate)}`);
  out.push('');

  const ev = bm.events;
  const sb = groupStoryboard(ev.storyboardLines);
  out.push('[Events]');
  out.push('//Background and Video events');
  if (ev.background) out.push(`0,0,"${ev.background.filename}",${ev.background.x},${ev.background.y}`);
  if (ev.video) out.push(`Video,${ev.video.startTime},"${ev.video.filename}",${ev.video.x},${ev.video.y}`);
  out.push('//Break Periods');
  for (const br of [...ev.breaks].sort((a, c) => a.start - c.start)) out.push(`2,${Math.round(br.start)},${Math.round(br.end)}`);
  out.push('//Storyboard Layer 0 (Background)', ...sb.Background);
  out.push('//Storyboard Layer 1 (Fail)', ...sb.Fail);
  out.push('//Storyboard Layer 2 (Pass)', ...sb.Pass);
  out.push('//Storyboard Layer 3 (Foreground)', ...sb.Foreground);
  out.push('//Storyboard Layer 4 (Overlay)', ...sb.Overlay);
  out.push('//Storyboard Sound Samples', ...sb.Samples, ...sb.Other);
  out.push('');

  out.push('[TimingPoints]');
  for (const tp of bm.timingPoints) {
    const effects = (tp.kiai ? 1 : 0) | (tp.omitFirstBarLine ? 8 : 0);
    out.push([tp.time, n(tp.beatLength), tp.meter, tp.sampleSet, tp.sampleIndex, tp.volume, b(tp.uninherited), effects].join(','));
  }
  out.push('');

  if (bm.colours.combo.length || bm.colours.sliderBorder || bm.colours.sliderTrackOverride) {
    out.push('');
    out.push('[Colours]');
    bm.colours.combo.forEach((c, i) => out.push(`Combo${i + 1} : ${rgb(c)}`));
    if (bm.colours.sliderTrackOverride) out.push(`SliderTrackOverride : ${rgb(bm.colours.sliderTrackOverride)}`);
    if (bm.colours.sliderBorder) out.push(`SliderBorder : ${rgb(bm.colours.sliderBorder)}`);
    out.push('');
  }

  out.push('[HitObjects]');
  for (const o of [...bm.hitObjects].sort((a, c) => a.time - c.time)) out.push(serializeHitObject(o, g.mode));
  out.push('');
  return out.join('\r\n');
}

export function sampleSetLabel(s: number): string {
  return SAMPLE_SET_NAMES[s] ?? 'auto';
}
