// Data model for a single .osu difficulty (file format v14).

export type GameMode = 0 | 1 | 2 | 3; // osu!, taiko, catch, mania
export const MODE_NAMES = ['osu!', 'osu!taiko', 'osu!catch', 'osu!mania'] as const;

export type SampleSetName = 'None' | 'Normal' | 'Soft' | 'Drum';
/** 0 = auto/inherit, 1 = normal, 2 = soft, 3 = drum */
export type SampleSet = 0 | 1 | 2 | 3;
export const SAMPLE_SET_NAMES = ['auto', 'normal', 'soft', 'drum'] as const;

export const HitSound = {
  Normal: 1,
  Whistle: 2,
  Finish: 4,
  Clap: 8,
} as const;

export interface Vec2 {
  x: number;
  y: number;
}

export interface HitSample {
  normalSet: SampleSet;
  additionSet: SampleSet;
  index: number; // 0 = use timing point's custom index
  volume: number; // 0 = use timing point's volume
  filename: string;
}

export type CurveType = 'B' | 'L' | 'P' | 'C';

interface HitObjectBase {
  /** Editor-only stable id, not serialized. */
  id: number;
  x: number;
  y: number;
  time: number;
  newCombo: boolean;
  /** Number of extra combo colours to skip (0-7). */
  comboSkip: number;
  hitSound: number;
  sample: HitSample;
}

export interface Circle extends HitObjectBase {
  kind: 'circle';
}

export interface Slider extends HitObjectBase {
  kind: 'slider';
  curveType: CurveType;
  /** Control points after the head (the head is x/y). Consecutive duplicates = red anchors. */
  points: Vec2[];
  /** Number of times the slider is traversed (repeats + 1). */
  slides: number;
  /** Visual length in osu!pixels. */
  length: number;
  edgeSounds: number[];
  edgeSets: { normal: SampleSet; addition: SampleSet }[];
}

export interface Spinner extends HitObjectBase {
  kind: 'spinner';
  endTime: number;
}

/** osu!mania hold note. */
export interface Hold extends HitObjectBase {
  kind: 'hold';
  endTime: number;
}

export type HitObject = Circle | Slider | Spinner | Hold;

export interface TimingPoint {
  time: number;
  /** For uninherited points: ms per beat. For inherited points: negative inverse SV percentage. */
  beatLength: number;
  meter: number;
  sampleSet: SampleSet;
  sampleIndex: number;
  volume: number;
  uninherited: boolean;
  kiai: boolean;
  omitFirstBarLine: boolean;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface BreakPeriod {
  start: number;
  end: number;
}

export interface BeatmapGeneral {
  audioFilename: string;
  audioLeadIn: number;
  previewTime: number;
  countdown: number;
  sampleSet: SampleSetName;
  stackLeniency: number;
  mode: GameMode;
  letterboxInBreaks: boolean;
  useSkinSprites: boolean;
  overlayPosition: string;
  skinPreference: string;
  epilepsyWarning: boolean;
  countdownOffset: number;
  specialStyle: boolean;
  widescreenStoryboard: boolean;
  samplesMatchPlaybackRate: boolean;
}

export interface BeatmapEditor {
  bookmarks: number[];
  distanceSpacing: number;
  beatDivisor: number;
  gridSize: number;
  timelineZoom: number;
}

export interface BeatmapMetadata {
  title: string;
  titleUnicode: string;
  artist: string;
  artistUnicode: string;
  creator: string;
  version: string;
  source: string;
  tags: string;
  beatmapId: number;
  beatmapSetId: number;
}

export interface BeatmapDifficulty {
  hpDrainRate: number;
  circleSize: number;
  overallDifficulty: number;
  approachRate: number;
  sliderMultiplier: number;
  sliderTickRate: number;
}

export interface BeatmapEvents {
  background: { filename: string; x: number; y: number } | null;
  video: { filename: string; startTime: number; x: number; y: number } | null;
  breaks: BreakPeriod[];
  /** Storyboard and any other event lines, kept verbatim. */
  storyboardLines: string[];
}

export interface BeatmapColours {
  combo: Rgb[];
  sliderTrackOverride: Rgb | null;
  sliderBorder: Rgb | null;
}

export interface Beatmap {
  formatVersion: number;
  general: BeatmapGeneral;
  editor: BeatmapEditor;
  metadata: BeatmapMetadata;
  difficulty: BeatmapDifficulty;
  events: BeatmapEvents;
  timingPoints: TimingPoint[];
  colours: BeatmapColours;
  hitObjects: HitObject[];
}

export const DEFAULT_COMBO_COLOURS: Rgb[] = [
  { r: 255, g: 192, b: 0 },
  { r: 0, g: 202, b: 0 },
  { r: 18, g: 124, b: 255 },
  { r: 242, g: 24, b: 57 },
];

let nextId = 1;
export function newObjectId(): number {
  return nextId++;
}

export function defaultSample(): HitSample {
  return { normalSet: 0, additionSet: 0, index: 0, volume: 0, filename: '' };
}

export function createEmptyBeatmap(): Beatmap {
  return {
    formatVersion: 14,
    general: {
      audioFilename: 'audio.mp3',
      audioLeadIn: 0,
      previewTime: -1,
      countdown: 0,
      sampleSet: 'Soft',
      stackLeniency: 0.7,
      mode: 0,
      letterboxInBreaks: false,
      useSkinSprites: false,
      overlayPosition: 'NoChange',
      skinPreference: '',
      epilepsyWarning: false,
      countdownOffset: 0,
      specialStyle: false,
      widescreenStoryboard: true,
      samplesMatchPlaybackRate: false,
    },
    editor: { bookmarks: [], distanceSpacing: 1, beatDivisor: 4, gridSize: 32, timelineZoom: 1 },
    metadata: {
      title: '',
      titleUnicode: '',
      artist: '',
      artistUnicode: '',
      creator: '',
      version: 'Normal',
      source: '',
      tags: '',
      beatmapId: 0,
      beatmapSetId: -1,
    },
    difficulty: {
      hpDrainRate: 5,
      circleSize: 4,
      overallDifficulty: 5,
      approachRate: 5,
      sliderMultiplier: 1.4,
      sliderTickRate: 1,
    },
    events: { background: null, video: null, breaks: [], storyboardLines: [] },
    timingPoints: [],
    colours: { combo: DEFAULT_COMBO_COLOURS.map((c) => ({ ...c })), sliderTrackOverride: null, sliderBorder: null },
    hitObjects: [],
  };
}

export function endTime(o: HitObject, sliderDuration: (s: Slider) => number): number {
  switch (o.kind) {
    case 'circle':
      return o.time;
    case 'slider':
      return o.time + sliderDuration(o) * o.slides;
    case 'spinner':
    case 'hold':
      return o.endTime;
  }
}
