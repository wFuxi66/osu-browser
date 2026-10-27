// Skins: osu!default (ppy's legacy default skin from osu-resources), the editor's own drawn style, and skins the user
// imports (.osk or a skin folder). Imported skins stay in this browser (IndexedDB) and are never uploaded.
import { hitsounds } from '../audio/hitsounds';
import { DEFAULT_COMBO_COLOURS, type Beatmap, type Rgb } from '../osu/types';

export interface SkinIni {
  name: string;
  author: string;
  comboColours: Rgb[];
  sliderBorder: Rgb | null;
  sliderTrackOverride: Rgb | null;
  sliderBall: Rgb | null;
  spinnerBackground: Rgb;
  cursorCentre: boolean;
  allowSliderBallTint: boolean;
  overlayAboveNumber: boolean;
  hitCirclePrefix: string;
  hitCircleOverlap: number;
  scorePrefix: string;
  scoreOverlap: number;
  comboPrefix: string;
  comboOverlap: number;
}

/** A skin image; w and h are in standard-definition pixels (an @2x file counts half). */
export interface Texture {
  image: CanvasImageSource;
  w: number;
  h: number;
}

export interface SkinEntry {
  id: string;
  name: string;
  builtin: boolean;
}

export const DEFAULT_SKIN_ID = 'default';
export const DRAWN_SKIN_ID = 'drawn';
const BUILTIN: SkinEntry[] = [
  { id: DEFAULT_SKIN_ID, name: 'osu!default', builtin: true },
  { id: DRAWN_SKIN_ID, name: 'Drawn (no images)', builtin: true },
];

/** The file names of stable's mod icons (selection-mod-<name>.png). */
export const MOD_ICON_NAMES = ['easy', 'nofail', 'halftime', 'hardrock', 'suddendeath', 'perfect', 'doubletime', 'nightcore', 'hidden', 'flashlight', 'relax', 'relax2', 'spunout', 'autoplay', 'cinema', 'scorev2'];

// Elements the editor draws, each with the names it may be found under (animated ones fall back to frame 0).
const ELEMENTS: Record<string, string[]> = {
  hitcircle: ['hitcircle'],
  hitcircleoverlay: ['hitcircleoverlay', 'hitcircleoverlay-0'],
  hitcircleselect: ['hitcircleselect'],
  sliderstartcircle: ['sliderstartcircle'],
  sliderstartcircleoverlay: ['sliderstartcircleoverlay', 'sliderstartcircleoverlay-0'],
  sliderendcircle: ['sliderendcircle'],
  sliderendcircleoverlay: ['sliderendcircleoverlay', 'sliderendcircleoverlay-0'],
  approachcircle: ['approachcircle'],
  reversearrow: ['reversearrow'],
  followpoint: ['followpoint', 'followpoint-0'],
  sliderb: ['sliderb', 'sliderb0'],
  'sliderb-nd': ['sliderb-nd'],
  'sliderb-spec': ['sliderb-spec'],
  sliderfollowcircle: ['sliderfollowcircle', 'sliderfollowcircle-0'],
  sliderscorepoint: ['sliderscorepoint'],
  'spinner-approachcircle': ['spinner-approachcircle'],
  'spinner-bottom': ['spinner-bottom'],
  'spinner-top': ['spinner-top'],
  'spinner-middle': ['spinner-middle'],
  'spinner-middle2': ['spinner-middle2'],
  'spinner-glow': ['spinner-glow'],
  'spinner-circle': ['spinner-circle'],
  'spinner-background': ['spinner-background'],
  'spinner-metre': ['spinner-metre'],
  cursor: ['cursor'],
  cursormiddle: ['cursormiddle'],
  hit0: ['hit0', 'hit0-0'],
  hit50: ['hit50', 'hit50-0'],
  hit100: ['hit100', 'hit100-0'],
  hit300: ['hit300', 'hit300-0'],
  hit300g: ['hit300g', 'hit300g-0'],
  hit300k: ['hit300k', 'hit300k-0'],
  hit100k: ['hit100k', 'hit100k-0'],
  // Gameplay
  cursortrail: ['cursortrail'],
  'scorebar-bg': ['scorebar-bg'],
  'scorebar-colour': ['scorebar-colour', 'scorebar-colour-0'],
  'section-pass': ['section-pass'],
  'section-fail': ['section-fail'],
  'play-warningarrow': ['play-warningarrow'],
  'play-skip': ['play-skip', 'play-skip-0'],
  'spinner-clear': ['spinner-clear'],
  'spinner-spin': ['spinner-spin'],
  'inputoverlay-key': ['inputoverlay-key'],
  'inputoverlay-background': ['inputoverlay-background'],
  'pause-overlay': ['pause-overlay'],
  'fail-background': ['fail-background'],
  'pause-continue': ['pause-continue'],
  'pause-retry': ['pause-retry'],
  'pause-back': ['pause-back'],
  ...Object.fromEntries(['X', 'XH', 'S', 'SH', 'A', 'B', 'C', 'D'].flatMap((g) => [[`ranking-${g}`, [`ranking-${g}`]], [`ranking-${g}-small`, [`ranking-${g}-small`]]])),
  // Song select (osu!default has none: the drawn buttons show then)
  'menu-back': ['menu-back', 'menu-back-0'],
  ...Object.fromEntries(['mods', 'random', 'options'].flatMap((n) => [[`selection-${n}`, [`selection-${n}`]], [`selection-${n}-over`, [`selection-${n}-over`]]])),
  // Mod icons (osu!default has none: they're drawn then)
  ...Object.fromEntries(MOD_ICON_NAMES.map((n) => [`selection-mod-${n}`, [`selection-mod-${n}`]])),
};

/** The characters of the score and combo fonts, by the suffix of their file names. */
const SCORE_GLYPHS: Record<string, string> = { ',': 'comma', '.': 'dot', '%': 'percent', x: 'x' };
for (let d = 0; d < 10; d++) SCORE_GLYPHS[String(d)] = String(d);

// What public/skins/default holds (all @2x).
const DEFAULT_MISSING = /^(sliderstart|sliderend|spinner-(circle|background|metre)|play-skip|pause-|fail-background|selection-|menu-back)/;
const DEFAULT_FILES = [
  ...Object.keys(ELEMENTS).filter((k) => !DEFAULT_MISSING.test(k)),
  ...Array.from({ length: 10 }, (_, i) => `default-${i}`),
  ...Object.values(SCORE_GLYPHS).map((g) => `score-${g}`),
].map((n) => `${n === 'sliderb' ? 'sliderb0' : n}@2x.png`);

const DEFAULT_INI: SkinIni = {
  name: 'osu!default',
  author: 'ppy',
  comboColours: DEFAULT_COMBO_COLOURS,
  sliderBorder: null,
  sliderTrackOverride: null,
  sliderBall: null,
  spinnerBackground: { r: 100, g: 100, b: 100 },
  cursorCentre: true,
  allowSliderBallTint: false,
  overlayAboveNumber: true,
  hitCirclePrefix: 'default',
  hitCircleOverlap: -2,
  scorePrefix: 'score',
  scoreOverlap: 0,
  comboPrefix: 'score',
  comboOverlap: 0,
};

function parseColour(v: string): Rgb | null {
  const [r, g, b] = v.split(',').map((x) => Number(x.trim()));
  return [r, g, b].every((x) => Number.isFinite(x)) ? { r, g, b } : null;
}

export function parseSkinIni(text: string): SkinIni {
  const ini: SkinIni = { ...DEFAULT_INI, name: '', author: '', comboColours: [] };
  const combos: Rgb[] = [];
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      section = head[1].toLowerCase();
      continue;
    }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (section === 'general') {
      if (key === 'name') ini.name = value;
      else if (key === 'author') ini.author = value;
      else if (key === 'allowsliderballtint') ini.allowSliderBallTint = value === '1';
      else if (key === 'cursorcentre') ini.cursorCentre = value !== '0';
      // stable reads it with this typo too.
      else if (key === 'hitcircleoverlayabovenumber' || key === 'hitcircleoverlayabovenumer') ini.overlayAboveNumber = value !== '0';
    } else if (section === 'colours') {
      const c = parseColour(value);
      if (!c) continue;
      const m = /^combo([1-8])$/.exec(key);
      if (m) combos[Number(m[1]) - 1] = c;
      else if (key === 'sliderborder') ini.sliderBorder = c;
      else if (key === 'slidertrackoverride') ini.sliderTrackOverride = c;
      else if (key === 'sliderball') ini.sliderBall = c;
      else if (key === 'spinnerbackground') ini.spinnerBackground = c;
    } else if (section === 'fonts') {
      if (key === 'hitcircleprefix') ini.hitCirclePrefix = value.replace(/\\/g, '/').toLowerCase();
      else if (key === 'hitcircleoverlap') ini.hitCircleOverlap = Number(value) || 0;
      else if (key === 'scoreprefix') ini.scorePrefix = value.replace(/\\/g, '/').toLowerCase();
      else if (key === 'scoreoverlap') ini.scoreOverlap = Number(value) || 0;
      else if (key === 'comboprefix') ini.comboPrefix = value.replace(/\\/g, '/').toLowerCase();
      else if (key === 'combooverlap') ini.comboOverlap = Number(value) || 0;
    }
  }
  // Combo colours are read up to the first gap, like stable.
  for (const c of combos) {
    if (!c) break;
    ini.comboColours.push(c);
  }
  return ini;
}

export class Skin {
  private tints = new Map<string, Texture>();

  constructor(
    readonly id: string,
    readonly ini: SkinIni,
    private textures: Map<string, Texture>,
    /** Where missing elements come from, as stable falls back to its default skin. */
    private fallback: Skin | null = null,
  ) {}

  get(name: string): Texture | undefined {
    return this.textures.get(name) ?? this.fallback?.get(name);
  }

  /** The element name of frame `i` (wrapping) of the slider ball animation: plain "sliderb" when it doesn't animate. */
  sliderBallName(i: number): string {
    if (!this.textures.has('sliderb')) return this.fallback?.sliderBallName(i) ?? 'sliderb';
    let n = 0;
    while (this.textures.has(`sliderb:${n}`)) n++;
    return n ? `sliderb:${((i % n) + n) % n}` : 'sliderb';
  }

  /** Whether the skin itself (not its fallback) has this element. */
  has(name: string): boolean {
    return this.textures.has(name);
  }

  /** Whether this skin has any element of its own (rather than only falling back). */
  get hasOwnElements(): boolean {
    return this.textures.size > 0;
  }

  /** The hit circle number glyph for a digit. */
  digit(d: string): Texture | undefined {
    return this.get(`digit-${d}`);
  }

  /** A character of the score or combo font (digits, ",", ".", "%", "x"), with the font's overlap. */
  glyph(font: 'score' | 'combo', ch: string): Texture | undefined {
    // A skin without its own font uses the fallback's whole font rather than mixing.
    const own = this.textures.get(`${font}:0`);
    return own ? this.textures.get(`${font}:${ch}`) : this.fallback?.glyph(font, ch);
  }

  overlap(font: 'score' | 'combo'): number {
    if (!this.textures.get(`${font}:0`) && this.fallback) return this.fallback.overlap(font);
    return font === 'score' ? this.ini.scoreOverlap : this.ini.comboOverlap;
  }

  /** The texture multiplied by a colour, as osu! tints combo-coloured elements. */
  tinted(name: string, c: Rgb): Texture | undefined {
    const tex = this.get(name);
    if (!tex) return undefined;
    const key = `${name}|${c.r},${c.g},${c.b}`;
    let out = this.tints.get(key);
    if (!out) {
      const src = tex.image as ImageBitmap;
      const canvas = document.createElement('canvas');
      canvas.width = src.width;
      canvas.height = src.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(src, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(src, 0, 0);
      out = { image: canvas, w: tex.w, h: tex.h };
      this.tints.set(key, out);
    }
    return out;
  }
}

/** Builds a skin from its files (keys: lower-case paths inside the skin folder). */
async function buildSkin(id: string, files: Map<string, Blob>, ini: SkinIni, fallback: Skin | null = null): Promise<Skin> {
  const textures = new Map<string, Texture>();
  const find = async (name: string): Promise<Texture | undefined> => {
    for (const [suffix, scale] of [['@2x.png', 2], ['.png', 1], ['@2x.jpg', 2], ['.jpg', 1]] as const) {
      const blob = files.get(name + suffix);
      if (!blob) continue;
      try {
        const image = await createImageBitmap(blob);
        return { image, w: image.width / scale, h: image.height / scale };
      } catch {
        /* not an image */
      }
    }
    return undefined;
  };
  const jobs: Promise<void>[] = [];
  for (const [element, names] of Object.entries(ELEMENTS)) {
    jobs.push(
      (async () => {
        for (const n of names) {
          const t = await find(n);
          if (t) return void textures.set(element, t);
        }
      })(),
    );
  }
  for (let d = 0; d < 10; d++) {
    jobs.push(
      (async () => {
        const t = (await find(`${ini.hitCirclePrefix}-${d}`)) ?? (await find(`default-${d}`));
        if (t) textures.set(`digit-${d}`, t);
      })(),
    );
  }
  // The score and combo fonts: kept only when the skin has all ten digits, so fonts never mix.
  for (const [font, prefix] of [['score', ini.scorePrefix], ['combo', ini.comboPrefix]] as const) {
    jobs.push(
      (async () => {
        const found = await Promise.all(Object.entries(SCORE_GLYPHS).map(async ([ch, suffix]) => [ch, (await find(`${prefix}-${suffix}`)) ?? (await find(`score-${suffix}`))] as const));
        if (found.filter(([ch, t]) => /\d/.test(ch) && t).length < 10) return;
        for (const [ch, t] of found) if (t) textures.set(`${font}:${ch}`, t);
      })(),
    );
  }
  // The slider ball's rolling animation, sliderb0, sliderb1, ... (kept only when there's more than one frame).
  jobs.push(
    (async () => {
      const frames: Texture[] = [];
      for (let i = 0; i < 60; i++) {
        const t = await find(`sliderb${i}`);
        if (!t) break;
        frames.push(t);
      }
      if (frames.length > 1) frames.forEach((t, i) => textures.set(`sliderb:${i}`, t));
    })(),
  );
  await Promise.all(jobs);
  return new Skin(id, ini, textures, fallback);
}

// ------------------------------------------------------------------ storage of imported skins

interface StoredSkin {
  id: string;
  name: string;
  files: { name: string; blob: Blob }[];
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('osu-web-editor-skins', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('skins', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('skins', mode).objectStore('skins'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const KEEP = /\.(png|jpe?g|wav|ogg|mp3|ini)$/i;

/** Lower-cases names and drops a folder that wraps everything (zips often contain "Skin Name/…"). */
function normalise(entries: [string, Blob][]): Map<string, Blob> {
  const paths = entries.map(([n]) => n.replace(/\\/g, '/').replace(/^\/+/, ''));
  const first = paths[0]?.split('/')[0];
  const wrapped = paths.length > 0 && paths.every((p) => p.includes('/') && p.split('/')[0] === first);
  const out = new Map<string, Blob>();
  paths.forEach((p, i) => {
    const name = (wrapped ? p.slice(first.length + 1) : p).toLowerCase();
    if (KEEP.test(name)) out.set(name, entries[i][1]);
  });
  return out;
}

// ------------------------------------------------------------------ the selected skin

class SkinManager {
  /** The skin being drawn with, or null for the editor's drawn style (or while the first skin loads). */
  get current(): Skin | null {
    return this.beatmapLayer ?? this.drawnBase;
  }
  /** The user's chosen skin, without beatmap skins or the editor's osu!default: for the menus and other screens. */
  get chosen(): Skin | null {
    return this.base;
  }
  /** The user's chosen skin. */
  private base: Skin | null = null;
  /** Whether the editor is showing and wants osu!default rather than the user's skin. */
  private editorDefault = false;
  private defaultLoaded: Skin | null = null;
  /** What's drawn with under any beatmap skin: osu!default in the editor (when asked for), else the user's skin. */
  private get drawnBase(): Skin | null {
    return this.editorDefault && this.base && this.base.id !== DEFAULT_SKIN_ID ? this.defaultLoaded : this.base;
  }
  /** The open beatmap's own skin elements over the user's skin, when beatmap skins are on and it has any. */
  private beatmapLayer: Skin | null = null;
  private beatmapKey: { files: Map<string, Blob> | null; base: Skin | null } = { files: null, base: null };
  currentId = '';
  private listeners = new Set<() => void>();
  private request = 0;

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  async list(): Promise<SkinEntry[]> {
    let stored: StoredSkin[] = [];
    try {
      stored = await store('readonly', (s) => s.getAll() as IDBRequest<StoredSkin[]>);
    } catch {
      /* IndexedDB unavailable */
    }
    return [...BUILTIN, ...stored.map((s) => ({ id: s.id, name: s.name, builtin: false })).sort((a, b) => a.name.localeCompare(b.name))];
  }

  /** Switches to a skin; unknown ids fall back to osu!default. */
  async use(id: string): Promise<void> {
    if (id === this.currentId) return;
    const req = ++this.request;
    this.currentId = id;
    let skin: Skin | null = null;
    let samples = new Map<string, Blob>();
    try {
      if (id === DRAWN_SKIN_ID) skin = null;
      else if (id === DEFAULT_SKIN_ID) skin = await this.loadDefault();
      else {
        const rec = await store('readonly', (s) => s.get(id) as IDBRequest<StoredSkin | undefined>);
        if (!rec) {
          this.currentId = '';
          return this.use(DEFAULT_SKIN_ID);
        }
        const files = new Map(rec.files.map((f) => [f.name, f.blob]));
        const iniBlob = files.get('skin.ini');
        const ini = parseSkinIni(iniBlob ? await iniBlob.text() : '');
        skin = await buildSkin(id, files, ini, await this.loadDefault());
        samples = files;
      }
    } catch (e) {
      console.error('Loading the skin failed', e);
    }
    if (req !== this.request) return;
    this.base = skin;
    void hitsounds.setSkinSamples(samples);
    await this.setBeatmap(this.beatmapKey.files);
    this.emit();
  }

  private defaultSkin: Promise<Skin> | null = null;

  private loadDefault(): Promise<Skin> {
    this.defaultSkin ??= (async () => {
      const files = new Map<string, Blob>();
      await Promise.all(
        DEFAULT_FILES.map(async (f) => {
          const r = await fetch(`/skins/default/${f}`);
          if (r.ok) files.set(f, await r.blob());
        }),
      );
      this.defaultLoaded = await buildSkin(DEFAULT_SKIN_ID, files, { ...DEFAULT_INI, allowSliderBallTint: true });
      return this.defaultLoaded;
    })();
    return this.defaultSkin;
  }

  /**
   * While mapping, draws the playfield and timeline with osu!default whatever skin is chosen (stable's "default skin
   * in the editor"); the rest of the game keeps the user's skin.
   */
  async setEditorDefault(on: boolean): Promise<void> {
    if (on === this.editorDefault) return;
    this.editorDefault = on;
    if (on) await this.loadDefault();
    await this.setBeatmap(this.beatmapKey.files);
    this.emit();
  }

  /** Imports an .osk/.zip, or the files of a picked skin folder. Returns the new skin's entry. */
  async import(picked: File[]): Promise<SkinEntry> {
    let entries: [string, Blob][] = [];
    let fallbackName = 'Imported skin';
    if (picked.length === 1 && /\.(osk|zip)$/i.test(picked[0].name)) {
      // Loaded on demand: zips are only read and written on import and export.
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(picked[0]);
      for (const f of Object.values(zip.files)) if (!f.dir) entries.push([f.name, await f.async('blob')]);
      fallbackName = picked[0].name.replace(/\.(osk|zip)$/i, '');
    } else {
      entries = picked.map((f) => [f.webkitRelativePath || f.name, f]);
      fallbackName = picked[0]?.webkitRelativePath.split('/')[0] || fallbackName;
    }
    const files = normalise(entries);
    if (![...files.keys()].some((n) => n.endsWith('.png') || n === 'skin.ini')) throw new Error('No skin files found (skin.ini or images).');
    const iniBlob = files.get('skin.ini');
    const ini = parseSkinIni(iniBlob ? await iniBlob.text() : '');
    const rec: StoredSkin = {
      id: `user:${crypto.randomUUID()}`,
      name: ini.name || fallbackName,
      files: [...files].map(([name, blob]) => ({ name, blob })),
    };
    await store('readwrite', (s) => s.put(rec));
    return { id: rec.id, name: rec.name, builtin: false };
  }

  /**
   * Uses a beatmap folder's own skin images (hitcircle.png, default-1.png, …, at the top of the folder) over the
   * user's skin, as stable does unless "Ignore all beatmap skins" is on. Null turns it off.
   */
  async setBeatmap(files: Map<string, Blob> | null): Promise<void> {
    const base = this.drawnBase;
    if (files === this.beatmapKey.files && base === this.beatmapKey.base) return;
    this.beatmapKey = { files, base };
    let layer: Skin | null = null;
    if (files) {
      const own = new Map<string, Blob>();
      for (const [name, blob] of files) if (!/[/\\]/.test(name) && /\.(png|jpe?g)$/i.test(name)) own.set(name.toLowerCase(), blob);
      if (own.size) {
        const ini = base?.ini ?? DEFAULT_INI;
        const built = await buildSkin('beatmap', own, ini, base);
        if (this.beatmapKey.files === files && this.beatmapKey.base === base) layer = built.hasOwnElements ? built : null;
        else return;
      }
    }
    this.beatmapLayer = layer;
    this.emit();
  }

  async remove(id: string): Promise<void> {
    await store('readwrite', (s) => s.delete(id));
    if (id === this.currentId) await this.use(DEFAULT_SKIN_ID);
  }
}

export const skins = new SkinManager();

const urls = new WeakMap<Texture, string>();

/** A data URL of a skin texture, for showing it in the page (mod icons, grades) rather than on a canvas. */
export function textureUrl(tex: Texture): string {
  let u = urls.get(tex);
  if (!u) {
    const src = tex.image as ImageBitmap;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    u = c.toDataURL();
    urls.set(tex, u);
  }
  return u;
}

/** Combo colours: the beatmap's, else the skin's, else osu!'s defaults. */
export function comboColours(bm: Beatmap): Rgb[] {
  if (bm.colours.combo.length) return bm.colours.combo;
  const s = skins.current?.ini.comboColours;
  return s?.length ? s : DEFAULT_COMBO_COLOURS;
}

/** Slider body colours: the beatmap's overrides, else the skin's, else white border and the combo colour. */
export function sliderColours(bm: Beatmap, combo: Rgb): { track: Rgb; border: Rgb } {
  const ini = skins.current?.ini;
  return {
    track: bm.colours.sliderTrackOverride ?? ini?.sliderTrackOverride ?? combo,
    border: bm.colours.sliderBorder ?? ini?.sliderBorder ?? { r: 255, g: 255, b: 255 },
  };
}
