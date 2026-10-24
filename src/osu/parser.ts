import {
  createEmptyBeatmap,
  defaultSample,
  newObjectId,
  type Beatmap,
  type CurveType,
  type GameMode,
  type HitObject,
  type HitSample,
  type Rgb,
  type SampleSet,
  type SampleSetName,
  type TimingPoint,
  type Vec2,
} from './types';

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined) return fallback;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined): boolean {
  return v !== undefined && v.trim() === '1';
}

function clampSet(n: number): SampleSet {
  return (n >= 0 && n <= 3 ? Math.trunc(n) : 0) as SampleSet;
}

function parseSampleSetName(v: string): SampleSetName {
  const s = v.trim().toLowerCase();
  if (s === 'normal') return 'Normal';
  if (s === 'drum') return 'Drum';
  if (s === 'none') return 'None';
  return 'Soft';
}

function parseHitSample(s: string | undefined): HitSample {
  const sample = defaultSample();
  if (!s) return sample;
  const p = s.split(':');
  sample.normalSet = clampSet(num(p[0]));
  sample.additionSet = clampSet(num(p[1]));
  sample.index = num(p[2]);
  sample.volume = num(p[3]);
  sample.filename = p.slice(4).join(':');
  return sample;
}

function parseRgb(v: string): Rgb | null {
  const p = v.split(',').map((x) => num(x, -1));
  if (p.length < 3 || p.some((x) => x < 0)) return null;
  return { r: p[0], g: p[1], b: p[2] };
}

function unquote(s: string): string {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1);
  return s;
}

export function parseHitObject(line: string, mode: GameMode): HitObject | null {
  const p = line.split(',');
  if (p.length < 4) return null;
  const x = num(p[0]);
  const y = num(p[1]);
  const time = Math.round(num(p[2]));
  const type = Math.trunc(num(p[3]));
  const hitSound = Math.trunc(num(p[4]));
  const newCombo = (type & 4) !== 0;
  const comboSkip = (type >> 4) & 7;
  const base = { id: newObjectId(), x, y, time, newCombo, comboSkip, hitSound };

  if (type & 2) {
    const curveParts = (p[5] ?? '').split('|');
    let curveType: CurveType = 'B';
    const points: Vec2[] = [];
    for (const part of curveParts) {
      if (part.length === 1 && /[BLPC]/.test(part)) {
        if (points.length === 0) curveType = part as CurveType;
        continue;
      }
      const [px, py] = part.split(':');
      if (px === undefined || py === undefined) continue;
      points.push({ x: num(px), y: num(py) });
    }
    const slides = Math.max(1, Math.trunc(num(p[6], 1)));
    const length = num(p[7]);
    const edgeSounds: number[] = [];
    const edgeSets: { normal: SampleSet; addition: SampleSet }[] = [];
    const es = p[8] ? p[8].split('|') : [];
    const ess = p[9] ? p[9].split('|') : [];
    for (let i = 0; i <= slides; i++) {
      edgeSounds.push(es[i] !== undefined ? Math.trunc(num(es[i])) : hitSound);
      const pair = ess[i]?.split(':');
      edgeSets.push({ normal: clampSet(num(pair?.[0])), addition: clampSet(num(pair?.[1])) });
    }
    return {
      ...base,
      kind: 'slider',
      curveType,
      points,
      slides,
      length,
      edgeSounds,
      edgeSets,
      sample: parseHitSample(p[10]),
    };
  }
  if (type & 8) {
    return { ...base, kind: 'spinner', endTime: Math.round(num(p[5])), sample: parseHitSample(p[6]) };
  }
  if (type & 128) {
    const rest = (p[5] ?? '').split(':');
    const endTime = Math.round(num(rest[0]));
    return { ...base, kind: 'hold', endTime, sample: parseHitSample(rest.slice(1).join(':')) };
  }
  void mode;
  return { ...base, kind: 'circle', sample: parseHitSample(p[5]) };
}

export function parseTimingPoint(line: string): TimingPoint | null {
  const p = line.split(',');
  if (p.length < 2) return null;
  const beatLength = num(p[1]);
  const effects = Math.trunc(num(p[7]));
  return {
    time: Math.round(num(p[0])),
    beatLength,
    meter: Math.trunc(num(p[2], 4)) || 4,
    sampleSet: clampSet(num(p[3], 0)),
    sampleIndex: Math.trunc(num(p[4], 0)),
    volume: Math.trunc(num(p[5], 100)),
    uninherited: p[6] !== undefined ? bool(p[6]) : beatLength > 0,
    kiai: (effects & 1) !== 0,
    omitFirstBarLine: (effects & 8) !== 0,
  };
}

export function parseBeatmap(text: string): Beatmap {
  const bm = createEmptyBeatmap();
  bm.colours.combo = [];
  bm.general.previewTime = -1;
  // Files from before v8 have no ApproachRate line; osu! uses OD for it (see normalizeBeatmap).
  bm.difficulty.approachRate = NaN;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let section = '';
  const pendingObjects: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (section !== 'Events' && line.trimStart().startsWith('//')) continue;

    const versionMatch = /^osu file format v(\d+)/.exec(line);
    if (versionMatch) {
      bm.formatVersion = Number(versionMatch[1]);
      continue;
    }
    const sectionMatch = /^\[(\w+)\]\s*$/.exec(line.trim());
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (section === 'General' || section === 'Editor' || section === 'Metadata' || section === 'Difficulty') {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      applyKeyValue(bm, section, key, value);
    } else if (section === 'Events') {
      parseEventLine(bm, rawLine);
    } else if (section === 'TimingPoints') {
      const tp = parseTimingPoint(line);
      if (tp) bm.timingPoints.push(tp);
    } else if (section === 'Colours') {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      const rgb = parseRgb(line.slice(idx + 1));
      if (!rgb) continue;
      if (/^Combo\d+$/.test(key)) bm.colours.combo.push(rgb);
      else if (key === 'SliderTrackOverride') bm.colours.sliderTrackOverride = rgb;
      else if (key === 'SliderBorder') bm.colours.sliderBorder = rgb;
    } else if (section === 'HitObjects') {
      pendingObjects.push(line);
    }
  }

  for (const l of pendingObjects) {
    const o = parseHitObject(l, bm.general.mode);
    if (o) bm.hitObjects.push(o);
  }
  bm.hitObjects.sort((a, b) => a.time - b.time);
  bm.timingPoints.sort((a, b) => a.time - b.time || (a.uninherited === b.uninherited ? 0 : a.uninherited ? -1 : 1));
  return bm;
}

function applyKeyValue(bm: Beatmap, section: string, key: string, value: string) {
  const g = bm.general;
  const e = bm.editor;
  const m = bm.metadata;
  const d = bm.difficulty;
  if (section === 'General') {
    switch (key) {
      case 'AudioFilename': g.audioFilename = value; break;
      case 'AudioLeadIn': g.audioLeadIn = num(value); break;
      case 'PreviewTime': g.previewTime = num(value, -1); break;
      case 'Countdown': g.countdown = num(value); break;
      case 'SampleSet': g.sampleSet = parseSampleSetName(value); break;
      case 'StackLeniency': g.stackLeniency = num(value, 0.7); break;
      case 'Mode': g.mode = Math.min(3, Math.max(0, num(value))) as GameMode; break;
      case 'LetterboxInBreaks': g.letterboxInBreaks = bool(value); break;
      case 'UseSkinSprites': g.useSkinSprites = bool(value); break;
      case 'OverlayPosition': g.overlayPosition = value; break;
      case 'SkinPreference': g.skinPreference = value; break;
      case 'EpilepsyWarning': g.epilepsyWarning = bool(value); break;
      case 'CountdownOffset': g.countdownOffset = num(value); break;
      case 'SpecialStyle': g.specialStyle = bool(value); break;
      case 'WidescreenStoryboard': g.widescreenStoryboard = bool(value); break;
      case 'SamplesMatchPlaybackRate': g.samplesMatchPlaybackRate = bool(value); break;
    }
  } else if (section === 'Editor') {
    switch (key) {
      case 'Bookmarks':
        e.bookmarks = value.split(',').map((v) => num(v, NaN)).filter((v) => Number.isFinite(v));
        break;
      case 'DistanceSpacing': e.distanceSpacing = num(value, 1); break;
      case 'BeatDivisor': e.beatDivisor = num(value, 4) || 4; break;
      case 'GridSize': e.gridSize = num(value, 32) || 32; break;
      case 'TimelineZoom': e.timelineZoom = num(value, 1) || 1; break;
    }
  } else if (section === 'Metadata') {
    switch (key) {
      case 'Title': m.title = value; break;
      case 'TitleUnicode': m.titleUnicode = value; break;
      case 'Artist': m.artist = value; break;
      case 'ArtistUnicode': m.artistUnicode = value; break;
      case 'Creator': m.creator = value; break;
      case 'Version': m.version = value; break;
      case 'Source': m.source = value; break;
      case 'Tags': m.tags = value; break;
      case 'BeatmapID': m.beatmapId = num(value); break;
      case 'BeatmapSetID': m.beatmapSetId = num(value, -1); break;
    }
  } else if (section === 'Difficulty') {
    switch (key) {
      case 'HPDrainRate': d.hpDrainRate = num(value, 5); break;
      case 'CircleSize': d.circleSize = num(value, 5); break;
      case 'OverallDifficulty': d.overallDifficulty = num(value, 5); break;
      case 'ApproachRate': d.approachRate = num(value, NaN); break;
      case 'SliderMultiplier': d.sliderMultiplier = num(value, 1.4); break;
      case 'SliderTickRate': d.sliderTickRate = num(value, 1); break;
    }
  }
}

function parseEventLine(bm: Beatmap, rawLine: string) {
  const line = rawLine.trimEnd();
  // Section header comments are regenerated by the serializer.
  if (/^\/\/(Background and Video events|Break Periods|Storyboard Layer \d|Storyboard Sound Samples)/.test(line)) return;
  // Indented lines are storyboard commands; other comments are kept verbatim.
  if (/^[ _]/.test(line) || line.startsWith('//')) {
    bm.events.storyboardLines.push(line);
    return;
  }
  const p = line.split(',');
  const kind = p[0].trim();
  if (kind === '0' && p.length >= 3) {
    bm.events.background = { filename: unquote(p[2]), x: num(p[3]), y: num(p[4]) };
  } else if ((kind === '1' || kind === 'Video') && p.length >= 3) {
    bm.events.video = { filename: unquote(p[2]), startTime: num(p[1]), x: num(p[3]), y: num(p[4]) };
  } else if ((kind === '2' || kind === 'Break') && p.length >= 3) {
    bm.events.breaks.push({ start: Math.round(num(p[1])), end: Math.round(num(p[2])) });
  } else {
    bm.events.storyboardLines.push(line);
  }
}

// Fill in values older formats leave implicit.
export function normalizeBeatmap(bm: Beatmap): Beatmap {
  if (!Number.isFinite(bm.difficulty.approachRate)) bm.difficulty.approachRate = bm.difficulty.overallDifficulty;
  return bm;
}

export function parseOsu(text: string): Beatmap {
  return normalizeBeatmap(parseBeatmap(text));
}
