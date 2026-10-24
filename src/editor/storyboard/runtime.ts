// Live storyboard state for the open project: parsed .osb + difficulty storyboard, compiled timelines,
// image loading, and canvas rendering in storyboard space (640x480, 854x480 when widescreen).
import { findFile } from '../../project/project';
import { controlPointAt, sliderSpanDuration } from '../../osu/timing';
import {
  animationFrameFile,
  compileSprite,
  ORIGIN_ANCHOR,
  parseOsb,
  parseStoryboardLines,
  referencedFiles,
  serializeOsb,
  serializeStoryboardLines,
  spriteStateAt,
  type CompiledSprite,
  type ParsedStoryboard,
  type SbElement,
  type SbLayer,
  type SbSprite,
  type SpriteState,
  type TriggerHit,
} from '../../osu/storyboard';
import type { Beatmap, Vec2 } from '../../osu/types';
import { editor } from '../store';

export const SB_W = 640;
export const SB_H = 480;
/** Extra width on each side of the 4:3 area in widescreen storyboards ((854 - 640) / 2). */
export const SB_WIDE_MARGIN = 107;

/** Maps storyboard coordinates to canvas pixels: screen = o + p * scale. */
export interface SbFrame {
  ox: number;
  oy: number;
  scale: number;
}

/** Fit the storyboard's 640x480 area into a w x h canvas (height-filling, centred), like the game. */
export function fitFrame(w: number, h: number, widescreen: boolean): SbFrame {
  const scale = Math.min(w / (widescreen ? SB_W + 2 * SB_WIDE_MARGIN : SB_W), h / SB_H);
  return { scale, ox: w / 2 - (SB_W / 2) * scale, oy: h / 2 - (SB_H / 2) * scale };
}

export type SbSource = 'osb' | 'diff';
export interface SbRef {
  source: SbSource;
  index: number;
}

const DRAW_LAYERS: SbLayer[] = ['Background', 'Pass', 'Foreground', 'Overlay'];

function defaultOsbName(bm: Beatmap): string {
  const m = bm.metadata;
  return `${m.artist} - ${m.title} (${m.creator}).osb`.replace(/[\\/:*?"<>|]/g, '');
}

/** Resolved hitsound events used by HitSound triggers. */
export function triggerHits(bm: Beatmap): TriggerHit[] {
  const defaultSet = bm.general.sampleSet === 'Normal' ? 1 : bm.general.sampleSet === 'Drum' ? 3 : 2;
  const out: TriggerHit[] = [];
  const push = (time: number, bits: number, normal: number, addition: number, index: number) => {
    const tp = controlPointAt(bm, time);
    const ns = normal || tp.sampleSet || defaultSet;
    out.push({ time, normalSet: ns, additionSet: addition || ns, additions: bits & 14, index: index || tp.sampleIndex });
  };
  for (const o of bm.hitObjects) {
    const s = o.sample;
    if (o.kind === 'slider') {
      const span = sliderSpanDuration(bm, o);
      for (let i = 0; i <= o.slides; i++) {
        const set = o.edgeSets[i] ?? { normal: 0, addition: 0 };
        push(o.time + span * i, o.edgeSounds[i] ?? 0, set.normal || s.normalSet, set.addition || s.additionSet, s.index);
      }
    } else {
      push(o.kind === 'spinner' ? o.endTime : o.time, o.hitSound, s.normalSet, s.additionSet, s.index);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

class StoryboardRuntime {
  osb: ParsedStoryboard = { elements: [], extra: [] };
  diff: ParsedStoryboard = { elements: [], extra: [] };
  osbName = '';
  /** Bumped whenever the parsed storyboard changes (for dependent caches like sample scheduling). */
  rev = 0;

  private osbBlob: Blob | null | undefined = undefined;
  private osbLoading: Blob | null = null;
  private diffLines: string[] | null = null;
  private compiled = new WeakMap<SbSprite, CompiledSprite>();
  private hits: TriggerHit[] = [];
  private hitsKey = '';
  private blobByPath = new Map<string, Blob | null>();
  private blobCacheRev = -1;
  private images = new Map<Blob, HTMLImageElement>();
  private tints = new Map<string, HTMLCanvasElement>();

  /** Pick up project/difficulty changes. Cheap enough to call every frame. */
  sync() {
    const p = editor.project;
    if (!p) return;
    const bm = editor.bm;
    const name = [...p.files.keys()].find((n) => n.toLowerCase() === defaultOsbName(bm).toLowerCase()) ?? [...p.files.keys()].find((n) => n.toLowerCase().endsWith('.osb'));
    this.osbName = name ?? defaultOsbName(bm);
    const blob = name ? p.files.get(name)! : null;
    if (blob !== this.osbBlob && blob !== this.osbLoading) {
      if (!blob) {
        this.osbBlob = null;
        this.osb = { elements: [], extra: [] };
        this.rev++;
      } else {
        this.osbLoading = blob;
        void blob.text().then((text) => {
          if (this.osbLoading !== blob) return;
          this.osbLoading = null;
          this.osbBlob = blob;
          this.osb = parseOsb(text);
          this.rev++;
        });
      }
    }
    const lines = bm.events.storyboardLines;
    if (lines !== this.diffLines) {
      this.diffLines = lines;
      this.diff = parseStoryboardLines(lines);
      this.rev++;
    }
    const key = `${editor.contentRev}:${editor.diffIndex}`;
    if (key !== this.hitsKey) {
      this.hitsKey = key;
      const hasTriggers = (sb: ParsedStoryboard) => sb.elements.some((e) => e.kind !== 'sample' && e.commands.some((c) => c.type === 'T'));
      if (hasTriggers(this.osb) || hasTriggers(this.diff) || this.hits.length) {
        this.hits = triggerHits(bm);
        for (const sb of [this.osb, this.diff]) for (const e of sb.elements) if (e.kind !== 'sample' && e.commands.some((c) => c.type === 'T')) this.compiled.delete(e);
      }
    }
  }

  get isEmpty(): boolean {
    return this.osb.elements.length === 0 && this.diff.elements.length === 0;
  }

  get(ref: SbRef): SbElement | undefined {
    return this[ref.source].elements[ref.index];
  }

  /** All elements in draw order (per layer: .osb first, then the difficulty's). */
  *drawOrder(): Generator<{ ref: SbRef; el: SbSprite }> {
    for (const layer of DRAW_LAYERS) {
      for (const source of ['osb', 'diff'] as const) {
        const els = this[source].elements;
        for (let i = 0; i < els.length; i++) {
          const el = els[i];
          if (el.kind !== 'sample' && el.layer === layer) yield { ref: { source, index: i }, el };
        }
      }
    }
  }

  compiledFor(el: SbSprite): CompiledSprite {
    let c = this.compiled.get(el);
    if (!c) {
      c = compileSprite(el, this.hits);
      this.compiled.set(el, c);
    }
    return c;
  }

  /** Call after mutating an element in place (visual editing). */
  invalidate(el: SbElement) {
    if (el.kind !== 'sample') this.compiled.delete(el);
    this.rev++;
  }

  /** Write the in-memory model back to the project (the .osb file or the difficulty's events). */
  save(source: SbSource) {
    if (source === 'osb') {
      const blob = new Blob([serializeOsb(this.osb)], { type: 'text/plain' });
      this.osbBlob = blob;
      this.osbLoading = null;
      editor.setFile(this.osbName, blob);
    } else {
      const lines = serializeStoryboardLines(this.diff);
      this.diffLines = lines;
      editor.commit((bm) => {
        bm.events.storyboardLines = lines;
      });
    }
    this.rev++;
  }

  /** True if the storyboard draws the beatmap's background file itself (stable then hides the background). */
  usesFile(name: string): boolean {
    const lower = name.toLowerCase().replace(/\\/g, '/');
    for (const sb of [this.osb, this.diff]) {
      for (const el of sb.elements) if (el.kind !== 'sample' && el.file.toLowerCase().replace(/\\/g, '/') === lower) return true;
    }
    return false;
  }

  missingFiles(): string[] {
    const p = editor.project;
    if (!p) return [];
    return referencedFiles([...this.osb.elements, ...this.diff.elements]).filter((f) => !findFile(p, f));
  }

  // ---------------------------------------------------------------- images

  private blobFor(path: string): Blob | null {
    if (this.blobCacheRev !== editor.contentRev) {
      this.blobCacheRev = editor.contentRev;
      this.blobByPath.clear();
    }
    let b = this.blobByPath.get(path);
    if (b === undefined) {
      b = (editor.project && findFile(editor.project, path)) || null;
      this.blobByPath.set(path, b);
    }
    return b;
  }

  image(path: string): HTMLImageElement | null {
    const blob = this.blobFor(path);
    if (!blob) return null;
    let img = this.images.get(blob);
    if (!img) {
      img = new Image();
      img.src = URL.createObjectURL(blob);
      this.images.set(blob, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  /** The image multiplied by a colour (canvas has no per-draw tint), cached per quantised colour. */
  private tinted(img: HTMLImageElement, path: string, c: [number, number, number]): CanvasImageSource {
    const q = c.map((v) => Math.max(0, Math.min(255, Math.round(v / 4) * 4)));
    if (q[0] >= 252 && q[1] >= 252 && q[2] >= 252) return img;
    const key = `${path}|${q.join(',')}`;
    let cv = this.tints.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext('2d')!;
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${q[0]},${q[1]},${q[2]})`;
      g.fillRect(0, 0, cv.width, cv.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(img, 0, 0);
      if (this.tints.size > 400) this.tints.delete(this.tints.keys().next().value!);
      this.tints.set(key, cv);
    }
    return cv;
  }

  // ---------------------------------------------------------------- geometry & drawing

  /** Current frame image of a sprite at time t. */
  frameImage(c: CompiledSprite, t: number): { img: HTMLImageElement; path: string } | null {
    const path = animationFrameFile(c.el, c.start, t);
    const img = this.image(path);
    return img ? { img, path } : null;
  }

  /** Corners of the sprite (storyboard coordinates) in TL, TR, BR, BL order. */
  quad(c: CompiledSprite, s: SpriteState, w: number, h: number): Vec2[] {
    const [ax, ay] = ORIGIN_ANCHOR[c.el.origin];
    const cos = Math.cos(s.rotation);
    const sin = Math.sin(s.rotation);
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ].map(([px, py]) => {
      const lx = (px - ax * w) * s.scaleX;
      const ly = (py - ay * h) * s.scaleY;
      return { x: s.x + lx * cos - ly * sin, y: s.y + lx * sin + ly * cos };
    });
  }

  drawSprite(ctx: CanvasRenderingContext2D, f: SbFrame, c: CompiledSprite, s: SpriteState, img: HTMLImageElement, path: string, alpha = 1) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const [ax, ay] = ORIGIN_ANCHOR[c.el.origin];
    ctx.save();
    ctx.globalAlpha = s.alpha * alpha;
    if (s.additive) ctx.globalCompositeOperation = 'lighter';
    ctx.translate(f.ox + s.x * f.scale, f.oy + s.y * f.scale);
    ctx.rotate(s.rotation);
    ctx.scale(s.scaleX * f.scale, s.scaleY * f.scale);
    ctx.translate(-ax * w, -ay * h);
    // Flips mirror the image in place within its own bounds.
    if (s.flipH || s.flipV) {
      ctx.translate(s.flipH ? w : 0, s.flipV ? h : 0);
      ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
    }
    ctx.drawImage(this.tinted(img, path, s.colour), 0, 0, w, h);
    ctx.restore();
  }

  /** Draw every visible sprite at time t. Returns true if anything was drawn. */
  draw(ctx: CanvasRenderingContext2D, f: SbFrame, t: number, opts: { widescreen: boolean; clip?: boolean; alpha?: number }): boolean {
    this.sync();
    if (this.isEmpty) return false;
    ctx.save();
    if (opts.clip !== false) {
      const m = opts.widescreen ? SB_WIDE_MARGIN : 0;
      ctx.beginPath();
      ctx.rect(f.ox - m * f.scale, f.oy, (SB_W + 2 * m) * f.scale, SB_H * f.scale);
      ctx.clip();
    }
    let drew = false;
    for (const { el } of this.drawOrder()) {
      const c = this.compiledFor(el);
      const s = spriteStateAt(c, t);
      if (!s || s.alpha <= 0.001 || s.scaleX === 0 || s.scaleY === 0) continue;
      const fi = this.frameImage(c, t);
      if (!fi) continue;
      this.drawSprite(ctx, f, c, s, fi.img, fi.path, opts.alpha ?? 1);
      drew = true;
    }
    ctx.restore();
    return drew;
  }

  /** Topmost visible sprite under a storyboard-space point. */
  hitTest(p: Vec2, t: number): SbRef | null {
    let found: SbRef | null = null;
    for (const { ref, el } of this.drawOrder()) {
      const c = this.compiledFor(el);
      const s = spriteStateAt(c, t);
      if (!s || s.alpha <= 0.001) continue;
      const fi = this.frameImage(c, t);
      if (!fi) continue;
      if (pointInQuad(p, this.quad(c, s, fi.img.naturalWidth, fi.img.naturalHeight))) found = ref;
    }
    return found;
  }

  /** Storyboard sound samples for playback scheduling (the fail layer is skipped, like a passing play). */
  samples(): { time: number; file: string; volume: number }[] {
    this.sync();
    const out: { time: number; file: string; volume: number }[] = [];
    for (const sb of [this.osb, this.diff]) for (const el of sb.elements) if (el.kind === 'sample' && el.layer !== 'Fail') out.push(el);
    return out;
  }
}

function pointInQuad(p: Vec2, q: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return sign !== 0;
}

export const storyboard = new StoryboardRuntime();
