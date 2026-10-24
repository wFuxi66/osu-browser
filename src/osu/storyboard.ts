// osu! storyboard scripting: parse (.osb + difficulty [Events]), evaluate at a time, and serialize back.
// Semantics follow stable/lazer: per-property timelines where the latest-starting command wins, the
// first command's start value applies before it, loops repeat their body, triggers fire on hitsounds.

export const SB_LAYERS = ['Background', 'Fail', 'Pass', 'Foreground', 'Overlay'] as const;
export type SbLayer = (typeof SB_LAYERS)[number];

export const SB_ORIGINS = [
  'TopLeft',
  'Centre',
  'CentreLeft',
  'TopRight',
  'BottomCentre',
  'TopCentre',
  'Custom',
  'CentreRight',
  'BottomLeft',
  'BottomRight',
] as const;
export type SbOrigin = (typeof SB_ORIGINS)[number];

/** Anchor point of each origin as a fraction of the image size. */
export const ORIGIN_ANCHOR: Record<SbOrigin, [number, number]> = {
  TopLeft: [0, 0],
  Centre: [0.5, 0.5],
  CentreLeft: [0, 0.5],
  TopRight: [1, 0],
  BottomCentre: [0.5, 1],
  TopCentre: [0.5, 0],
  Custom: [0, 0],
  CentreRight: [1, 0.5],
  BottomLeft: [0, 1],
  BottomRight: [1, 1],
};

export type SbCommandType = 'F' | 'M' | 'MX' | 'MY' | 'S' | 'V' | 'R' | 'C' | 'P';
export const SB_COMMAND_ARITY: Record<SbCommandType, number> = { F: 1, M: 2, MX: 1, MY: 1, S: 1, V: 2, R: 1, C: 3, P: 1 };
export const SB_COMMAND_NAMES: Record<SbCommandType, string> = {
  F: 'Fade',
  M: 'Move',
  MX: 'Move X',
  MY: 'Move Y',
  S: 'Scale',
  V: 'Vector scale',
  R: 'Rotate',
  C: 'Colour',
  P: 'Parameter',
};

export interface SbCommand {
  type: SbCommandType;
  easing: number;
  start: number;
  end: number;
  from: number[];
  to: number[];
  /** For P: H (flip horizontal), V (flip vertical) or A (additive blending). */
  param?: 'H' | 'V' | 'A';
}

export interface SbLoop {
  type: 'L';
  start: number;
  count: number;
  commands: SbCommand[];
}

export interface SbTrigger {
  type: 'T';
  trigger: string;
  start: number;
  end: number;
  group: number;
  commands: SbCommand[];
}

export type SbEntry = SbCommand | SbLoop | SbTrigger;

export interface SbSprite {
  kind: 'sprite' | 'animation';
  id: number;
  layer: SbLayer;
  origin: SbOrigin;
  file: string;
  x: number;
  y: number;
  frameCount: number;
  frameDelay: number;
  loopForever: boolean;
  commands: SbEntry[];
}

export interface SbSample {
  kind: 'sample';
  id: number;
  time: number;
  layer: SbLayer;
  file: string;
  volume: number;
}

export type SbElement = SbSprite | SbSample;

export interface ParsedStoryboard {
  elements: SbElement[];
  /** Top-level event lines that aren't storyboard elements (kept verbatim). */
  extra: string[];
}

let nextSbId = 1;
export function newSbId(): number {
  return nextSbId++;
}

// ------------------------------------------------------------------ parsing

function unquote(s: string): string {
  s = s.trim();
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function parseLayer(s: string): SbLayer {
  const t = s.trim();
  if (/^\d+$/.test(t)) return SB_LAYERS[Number(t)] ?? 'Background';
  return (SB_LAYERS as readonly string[]).includes(t) ? (t as SbLayer) : 'Background';
}

function parseOrigin(s: string): SbOrigin {
  const t = s.trim();
  if (/^\d+$/.test(t)) return SB_ORIGINS[Number(t)] ?? 'TopLeft';
  if (t === 'Center') return 'Centre';
  return (SB_ORIGINS as readonly string[]).includes(t) ? (t as SbOrigin) : 'TopLeft';
}

function num(s: string | undefined, fallback = 0): number {
  const v = Number(s);
  return Number.isFinite(v) ? v : fallback;
}

/** Parse one command line (without indentation) into one or more commands (chained values expand). */
export function parseCommand(body: string): SbCommand[] {
  const p = body.split(',');
  const type = p[0].trim() as SbCommandType;
  if (!(type in SB_COMMAND_ARITY)) return [];
  const easing = num(p[1]);
  const start = num(p[2]);
  const end = p[3] === undefined || p[3].trim() === '' ? start : num(p[3]);
  if (type === 'P') {
    const param = p[4]?.trim() as 'H' | 'V' | 'A';
    if (param !== 'H' && param !== 'V' && param !== 'A') return [];
    return [{ type, easing, start, end, from: [], to: [], param }];
  }
  const arity = SB_COMMAND_ARITY[type];
  const values = p.slice(4).map((v) => num(v));
  if (values.length < arity) return [];
  const groups: number[][] = [];
  for (let i = 0; i + arity <= values.length; i += arity) groups.push(values.slice(i, i + arity));
  if (groups.length === 1) return [{ type, easing, start, end, from: groups[0], to: groups[0].slice() }];
  // "F,0,1000,1500,0,1,0" chains: each extra value set is another segment of the same duration.
  const dur = end - start;
  const out: SbCommand[] = [];
  for (let i = 0; i + 1 < groups.length; i++) {
    out.push({ type, easing, start: start + dur * i, end: end + dur * i, from: groups[i], to: groups[i + 1] });
  }
  return out;
}

function substitute(line: string, variables: Map<string, string> | undefined): string {
  if (!variables || variables.size === 0 || !line.includes('$')) return line;
  return line.replace(/\$[A-Za-z0-9_]+/g, (m) => variables.get(m) ?? m);
}

/** Parse storyboard event lines (the [Events] body of an .osb or the storyboard part of a difficulty). */
export function parseStoryboardLines(lines: string[], variables?: Map<string, string>): ParsedStoryboard {
  const elements: SbElement[] = [];
  const extra: string[] = [];
  let sprite: SbSprite | null = null;
  let group: SbLoop | SbTrigger | null = null;
  for (const raw0 of lines) {
    const raw = substitute(raw0.replace(/\r$/, ''), variables);
    if (!raw.trim()) continue;
    if (raw.startsWith('//')) {
      if (!/^\/\/(Background and Video events|Break Periods|Storyboard Layer \d|Storyboard Sound Samples)/.test(raw)) extra.push(raw);
      continue;
    }
    let depth = 0;
    while (depth < raw.length && (raw[depth] === ' ' || raw[depth] === '_')) depth++;
    const body = raw.slice(depth);
    if (depth === 0) {
      sprite = null;
      group = null;
      const p = body.split(',');
      const kind = p[0].trim();
      if ((kind === 'Sprite' || kind === '4') && p.length >= 6) {
        sprite = {
          kind: 'sprite',
          id: newSbId(),
          layer: parseLayer(p[1]),
          origin: parseOrigin(p[2]),
          file: unquote(p[3]),
          x: num(p[4]),
          y: num(p[5]),
          frameCount: 1,
          frameDelay: 0,
          loopForever: true,
          commands: [],
        };
        elements.push(sprite);
      } else if ((kind === 'Animation' || kind === '6') && p.length >= 8) {
        sprite = {
          kind: 'animation',
          id: newSbId(),
          layer: parseLayer(p[1]),
          origin: parseOrigin(p[2]),
          file: unquote(p[3]),
          x: num(p[4]),
          y: num(p[5]),
          frameCount: Math.max(1, Math.round(num(p[6], 1))),
          frameDelay: num(p[7]),
          loopForever: (p[8]?.trim() ?? 'LoopForever') !== 'LoopOnce' && p[8]?.trim() !== '1',
          commands: [],
        };
        elements.push(sprite);
      } else if ((kind === 'Sample' || kind === '5') && p.length >= 4) {
        elements.push({ kind: 'sample', id: newSbId(), time: num(p[1]), layer: parseLayer(p[2]), file: unquote(p[3]), volume: num(p[4], 100) });
      } else {
        extra.push(raw);
      }
      continue;
    }
    if (!sprite) continue;
    const p = body.split(',');
    const type = p[0].trim();
    if (depth === 1 || !group) group = null;
    if (type === 'L') {
      group = { type: 'L', start: num(p[1]), count: Math.max(1, Math.round(num(p[2], 1))), commands: [] };
      sprite.commands.push(group);
    } else if (type === 'T') {
      group = { type: 'T', trigger: (p[1] ?? '').trim(), start: num(p[2]), end: num(p[3]), group: num(p[4]), commands: [] };
      sprite.commands.push(group);
    } else {
      const cmds = parseCommand(body);
      if (depth >= 2 && group) group.commands.push(...cmds);
      else sprite.commands.push(...cmds);
    }
  }
  return { elements, extra };
}

/** Parse a whole .osb file: [Variables] are substituted into [Events]. */
export function parseOsb(text: string): ParsedStoryboard {
  const variables = new Map<string, string>();
  const events: string[] = [];
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const m = /^\[(\w+)\]\s*$/.exec(line.trim());
    if (m) {
      section = m[1];
      continue;
    }
    if (section === 'Variables') {
      const i = line.indexOf('=');
      if (line.trim().startsWith('$') && i > 0) variables.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    } else if (section === 'Events') {
      events.push(line);
    }
  }
  return parseStoryboardLines(events, variables);
}

// ------------------------------------------------------------------ serialization

function fmt(v: number): string {
  return String(Math.round(v * 10000) / 10000);
}

function commandLine(c: SbCommand, indent: string): string {
  const head = `${indent}${c.type},${c.easing},${fmt(c.start)},${c.end === c.start ? '' : fmt(c.end)}`;
  if (c.type === 'P') return `${head},${c.param}`;
  const same = c.from.length === c.to.length && c.from.every((v, i) => v === c.to[i]);
  return `${head},${c.from.map(fmt).join(',')}${same ? '' : ',' + c.to.map(fmt).join(',')}`;
}

export function serializeElement(el: SbElement): string[] {
  if (el.kind === 'sample') return [`Sample,${fmt(el.time)},${SB_LAYERS.indexOf(el.layer)},"${el.file}",${fmt(el.volume)}`];
  const out = [
    el.kind === 'sprite'
      ? `Sprite,${el.layer},${el.origin},"${el.file}",${fmt(el.x)},${fmt(el.y)}`
      : `Animation,${el.layer},${el.origin},"${el.file}",${fmt(el.x)},${fmt(el.y)},${el.frameCount},${fmt(el.frameDelay)},${el.loopForever ? 'LoopForever' : 'LoopOnce'}`,
  ];
  for (const c of el.commands) {
    if (c.type === 'L') {
      out.push(` L,${fmt(c.start)},${c.count}`);
      for (const s of c.commands) out.push(commandLine(s, '  '));
    } else if (c.type === 'T') {
      out.push(` T,${c.trigger},${fmt(c.start)},${fmt(c.end)}${c.group ? ',' + c.group : ''}`);
      for (const s of c.commands) out.push(commandLine(s, '  '));
    } else {
      out.push(commandLine(c, ' '));
    }
  }
  return out;
}

/** Flat event lines (for a difficulty's storyboardLines; the .osu serializer adds layer headers). */
export function serializeStoryboardLines(sb: ParsedStoryboard): string[] {
  return [...sb.elements.flatMap(serializeElement), ...sb.extra];
}

/** A complete .osb file. */
export function serializeOsb(sb: ParsedStoryboard): string {
  const out = ['[Events]', '//Background and Video events'];
  for (const [i, layer] of SB_LAYERS.entries()) {
    out.push(`//Storyboard Layer ${i} (${layer})`);
    for (const el of sb.elements) if (el.kind !== 'sample' && el.layer === layer) out.push(...serializeElement(el));
  }
  out.push('//Storyboard Sound Samples');
  for (const el of sb.elements) if (el.kind === 'sample') out.push(...serializeElement(el));
  out.push(...sb.extra, '');
  return out.join('\r\n');
}

// ------------------------------------------------------------------ easing

const EC = (2 * Math.PI) / 0.3;
const EC2 = 0.3 / 4;
const BC = 1.70158;
const BC2 = BC * 1.525;
const BOUNCE = 1 / 2.75;

function outBounce(t: number): number {
  if (t < BOUNCE) return 7.5625 * t * t;
  if (t < 2 * BOUNCE) return 7.5625 * (t -= 1.5 * BOUNCE) * t + 0.75;
  if (t < 2.5 * BOUNCE) return 7.5625 * (t -= 2.25 * BOUNCE) * t + 0.9375;
  return 7.5625 * (t -= 2.625 * BOUNCE) * t + 0.984375;
}

const inOutPow = (t: number, n: number) => (t < 0.5 ? Math.pow(2, n - 1) * Math.pow(t, n) : 1 - Math.pow(2, n - 1) * Math.pow(1 - t, n));

export const EASING_NAMES = [
  'Linear', 'Out', 'In', 'InQuad', 'OutQuad', 'InOutQuad', 'InCubic', 'OutCubic', 'InOutCubic', 'InQuart', 'OutQuart', 'InOutQuart',
  'InQuint', 'OutQuint', 'InOutQuint', 'InSine', 'OutSine', 'InOutSine', 'InExpo', 'OutExpo', 'InOutExpo', 'InCirc', 'OutCirc',
  'InOutCirc', 'InElastic', 'OutElastic', 'OutElasticHalf', 'OutElasticQuarter', 'InOutElastic', 'InBack', 'OutBack', 'InOutBack',
  'InBounce', 'OutBounce', 'InOutBounce',
];

/** osu! easing functions (same numbering as the storyboard format / osu-framework). */
export function ease(easing: number, t: number): number {
  switch (easing) {
    case 1: case 4: return t * (2 - t);
    case 2: case 3: return t * t;
    case 5: return inOutPow(t, 2);
    case 6: return t * t * t;
    case 7: return 1 - Math.pow(1 - t, 3);
    case 8: return inOutPow(t, 3);
    case 9: return Math.pow(t, 4);
    case 10: return 1 - Math.pow(1 - t, 4);
    case 11: return inOutPow(t, 4);
    case 12: return Math.pow(t, 5);
    case 13: return 1 - Math.pow(1 - t, 5);
    case 14: return inOutPow(t, 5);
    case 15: return 1 - Math.cos((t * Math.PI) / 2);
    case 16: return Math.sin((t * Math.PI) / 2);
    case 17: return 0.5 - 0.5 * Math.cos(Math.PI * t);
    case 18: return Math.pow(2, 10 * (t - 1));
    case 19: return -Math.pow(2, -10 * t) + 1;
    case 20: return t < 0.5 ? 0.5 * Math.pow(2, 20 * t - 10) : 1 - 0.5 * Math.pow(2, -20 * t + 10);
    case 21: return 1 - Math.sqrt(1 - t * t);
    case 22: return Math.sqrt(1 - (t - 1) * (t - 1));
    case 23: return t < 0.5 ? 0.5 - 0.5 * Math.sqrt(1 - 4 * t * t) : 0.5 + 0.5 * Math.sqrt(1 - (2 * t - 2) * (2 * t - 2));
    case 24: return -Math.pow(2, -10 + 10 * t) * Math.sin((1 - EC2 - t) * EC);
    case 25: return Math.pow(2, -10 * t) * Math.sin((t - EC2) * EC) + 1;
    case 26: return Math.pow(2, -10 * t) * Math.sin((0.5 * t - EC2) * EC) + 1;
    case 27: return Math.pow(2, -10 * t) * Math.sin((0.25 * t - EC2) * EC) + 1;
    case 28: {
      const u = t * 2;
      if (u < 1) return -0.5 * Math.pow(2, -10 + 10 * u) * Math.sin((1 - EC2 * 1.5 - u) * (EC / 1.5));
      return 0.5 * Math.pow(2, -10 * (u - 1)) * Math.sin((u - 1 - EC2 * 1.5) * (EC / 1.5)) + 1;
    }
    case 29: return t * t * ((BC + 1) * t - BC);
    case 30: { const u = t - 1; return u * u * ((BC + 1) * u + BC) + 1; }
    case 31: {
      let u = t * 2;
      if (u < 1) return 0.5 * u * u * ((BC2 + 1) * u - BC2);
      u -= 2;
      return 0.5 * (u * u * ((BC2 + 1) * u + BC2) + 2);
    }
    case 32: return 1 - outBounce(1 - t);
    case 33: return outBounce(t);
    case 34: return t < 0.5 ? 0.5 - 0.5 * outBounce(1 - t * 2) : outBounce((t - 0.5) * 2) * 0.5 + 0.5;
    default: return t;
  }
}

// ------------------------------------------------------------------ evaluation

/** A resolved command on one property timeline (absolute times). */
export interface Seg {
  start: number;
  end: number;
  easing: number;
  from: number[];
  to: number[];
  /** Boolean parameter: true while active; `to` holds the value after it ends. */
  bool?: boolean;
}

export type Prop = 'x' | 'y' | 'scale' | 'vscale' | 'rotation' | 'alpha' | 'colour' | 'flipH' | 'flipV' | 'additive';

export interface CompiledSprite {
  el: SbSprite;
  start: number;
  end: number;
  timelines: Partial<Record<Prop, Seg[]>>;
}

export interface SpriteState {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  colour: [number, number, number];
  flipH: boolean;
  flipV: boolean;
  additive: boolean;
}

function pushSeg(tl: Partial<Record<Prop, Seg[]>>, prop: Prop, seg: Seg) {
  (tl[prop] ??= []).push(seg);
}

function addCommand(tl: Partial<Record<Prop, Seg[]>>, c: SbCommand, offset: number) {
  const start = c.start + offset;
  const end = c.end + offset;
  const base = { start, end, easing: c.easing };
  switch (c.type) {
    case 'F': pushSeg(tl, 'alpha', { ...base, from: c.from, to: c.to }); break;
    case 'S': pushSeg(tl, 'scale', { ...base, from: c.from, to: c.to }); break;
    case 'V': pushSeg(tl, 'vscale', { ...base, from: c.from, to: c.to }); break;
    case 'R': pushSeg(tl, 'rotation', { ...base, from: c.from, to: c.to }); break;
    case 'C': pushSeg(tl, 'colour', { ...base, from: c.from, to: c.to }); break;
    case 'MX': pushSeg(tl, 'x', { ...base, from: c.from, to: c.to }); break;
    case 'MY': pushSeg(tl, 'y', { ...base, from: c.from, to: c.to }); break;
    case 'M':
      pushSeg(tl, 'x', { ...base, from: [c.from[0]], to: [c.to[0]] });
      pushSeg(tl, 'y', { ...base, from: [c.from[1]], to: [c.to[1]] });
      break;
    case 'P': {
      const prop: Prop = c.param === 'H' ? 'flipH' : c.param === 'V' ? 'flipV' : 'additive';
      // A parameter with no duration stays on for the rest of the sprite's life.
      pushSeg(tl, prop, { ...base, from: [1], to: [start === end ? 1 : 0], bool: true });
      break;
    }
  }
}

function loopDuration(l: SbLoop): number {
  if (!l.commands.length) return 0;
  return Math.max(...l.commands.map((c) => c.end)) - Math.min(...l.commands.map((c) => c.start));
}

/** A hitsound event a trigger can react to. */
export interface TriggerHit {
  time: number;
  /** Resolved sample sets, 1 = normal, 2 = soft, 3 = drum. */
  normalSet: number;
  additionSet: number;
  /** Whistle/finish/clap bits (2/4/8). */
  additions: number;
  index: number;
}

const SET_BY_NAME: Record<string, number> = { All: 0, Normal: 1, Soft: 2, Drum: 3 };
const ADDITION_BY_NAME: Record<string, number> = { Whistle: 2, Finish: 4, Clap: 8 };

/** Does a HitSound… trigger name match this hit? Passing/Failing triggers never fire in the editor. */
export function triggerMatches(name: string, hit: TriggerHit): boolean {
  const m = /^HitSound(All|Normal|Soft|Drum)?(All|Normal|Soft|Drum)?(Whistle|Finish|Clap)?(\d+)?$/.exec(name);
  if (!m) return false;
  const [, a, b, addition, custom] = m;
  let normal = a ? SET_BY_NAME[a] : 0;
  let add = b ? SET_BY_NAME[b] : 0;
  // With a single set and an addition, the set refers to the addition's sample set.
  if (a && !b && addition) {
    add = normal;
    normal = 0;
  }
  if (normal && hit.normalSet !== normal) return false;
  if (addition) {
    const bit = ADDITION_BY_NAME[addition];
    if (!(hit.additions & bit)) return false;
    if (add && hit.additionSet !== add) return false;
  } else if (add && !(hit.additions && hit.additionSet === add)) return false;
  if (custom !== undefined && hit.index !== Number(custom)) return false;
  return true;
}

export function compileSprite(el: SbSprite, hits: TriggerHit[] = []): CompiledSprite {
  const tl: Partial<Record<Prop, Seg[]>> = {};
  let start = Infinity;
  let end = -Infinity;
  const extend = (s: number, e: number) => {
    start = Math.min(start, s);
    end = Math.max(end, e);
  };
  const triggers: SbTrigger[] = [];
  for (const c of el.commands) {
    if (c.type === 'L') {
      const dur = loopDuration(c);
      for (let k = 0; k < c.count; k++) for (const s of c.commands) addCommand(tl, s, c.start + k * dur);
      if (c.commands.length) {
        const first = Math.min(...c.commands.map((s) => s.start));
        extend(c.start + first, c.start + first + dur * c.count);
      }
    } else if (c.type === 'T') {
      triggers.push(c);
    } else {
      addCommand(tl, c, 0);
      extend(c.start, c.end);
    }
  }
  // Triggers: each firing replays the group's commands relative to the hit; a newer firing in the same
  // group cuts off what an older one would still do.
  const lastFireByGroup = new Map<number, number>();
  const firings: { t: number; trig: SbTrigger }[] = [];
  for (const trig of triggers) {
    for (const h of hits) if (h.time >= trig.start && h.time <= trig.end && triggerMatches(trig.trigger, h)) firings.push({ t: h.time, trig });
  }
  firings.sort((a, b) => b.t - a.t);
  for (const { t, trig } of firings) {
    const cutoff = lastFireByGroup.get(trig.group) ?? Infinity;
    lastFireByGroup.set(trig.group, t);
    for (const s of trig.commands) {
      if (s.start + t >= cutoff) continue;
      addCommand(tl, s, t);
      extend(s.start + t, Math.min(s.end + t, cutoff));
    }
  }
  for (const k in tl) tl[k as Prop]!.sort((a, b) => a.start - b.start);
  return { el, start, end, timelines: tl };
}

function lastStartedIndex(segs: Seg[], t: number): number {
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function valueAt(segs: Seg[] | undefined, t: number, i: number, fallback: number): number {
  if (!segs || !segs.length) return fallback;
  const k = lastStartedIndex(segs, t);
  if (k < 0) return segs[0].from[i];
  const s = segs[k];
  if (t >= s.end) return s.to[i];
  const p = ease(s.easing, (t - s.start) / (s.end - s.start));
  return s.from[i] + (s.to[i] - s.from[i]) * p;
}

function boolAt(segs: Seg[] | undefined, t: number): boolean {
  if (!segs) return false;
  const k = lastStartedIndex(segs, t);
  if (k < 0) return false;
  const s = segs[k];
  return t < s.end || s.start === s.end ? true : s.to[0] === 1;
}

/** One property's value at time t (component i), regardless of the sprite's lifetime. */
export function propValue(c: CompiledSprite, prop: Prop, t: number, i = 0, fallback = 0): number {
  return valueAt(c.timelines[prop], t, i, fallback);
}

/** State of a compiled sprite at time t, or null if it isn't alive. */
export function spriteStateAt(c: CompiledSprite, t: number): SpriteState | null {
  if (!(t >= c.start && t <= c.end)) return null;
  const tl = c.timelines;
  const s = valueAt(tl.scale, t, 0, 1);
  return {
    x: valueAt(tl.x, t, 0, c.el.x),
    y: valueAt(tl.y, t, 0, c.el.y),
    scaleX: s * valueAt(tl.vscale, t, 0, 1),
    scaleY: s * valueAt(tl.vscale, t, 1, 1),
    rotation: valueAt(tl.rotation, t, 0, 0),
    alpha: Math.max(0, Math.min(1, valueAt(tl.alpha, t, 0, 1))),
    colour: [valueAt(tl.colour, t, 0, 255), valueAt(tl.colour, t, 1, 255), valueAt(tl.colour, t, 2, 255)],
    flipH: boolAt(tl.flipH, t),
    flipV: boolAt(tl.flipV, t),
    additive: boolAt(tl.additive, t),
  };
}

/** File name of an animation frame ("sb/fire.png", 3 → "sb/fire3.png"). */
export function animationFrameFile(el: SbSprite, start: number, t: number): string {
  if (el.kind !== 'animation' || el.frameCount <= 1 || el.frameDelay <= 0) return el.file;
  let frame = Math.floor(Math.max(0, t - start) / el.frameDelay);
  frame = el.loopForever ? frame % el.frameCount : Math.min(frame, el.frameCount - 1);
  const dot = el.file.lastIndexOf('.');
  return dot < 0 ? `${el.file}${frame}` : `${el.file.slice(0, dot)}${frame}${el.file.slice(dot)}`;
}

/** Every distinct file a storyboard references (animation frames expanded). */
export function referencedFiles(elements: SbElement[]): string[] {
  const out = new Set<string>();
  for (const el of elements) {
    if (el.kind === 'animation') {
      const dot = el.file.lastIndexOf('.');
      for (let i = 0; i < el.frameCount; i++) out.add(dot < 0 ? `${el.file}${i}` : `${el.file.slice(0, dot)}${i}${el.file.slice(dot)}`);
    } else {
      out.add(el.file);
    }
  }
  return [...out];
}
