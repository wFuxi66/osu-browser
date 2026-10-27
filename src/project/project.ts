import { parseOsu } from '../osu/parser';
import { serializeBeatmap } from '../osu/serializer';
import { createEmptyBeatmap, type Beatmap } from '../osu/types';
import { md5, md5Text } from '../osu/md5';
import { readId3 } from './id3';
import { readZip } from './unzip';

export interface Difficulty {
  id: string;
  beatmap: Beatmap;
  /** For a difficulty imported from a .osu file: what it was, to tell whether it still is (see diffSource). */
  source?: DifficultySource;
}

/**
 * The imported .osu file's MD5 (osu!'s checksum for it) and the MD5 of the editor's own text for it at import.
 * The editor writes .osu files equivalently but not byte for byte, so while its text still hashes to
 * `savedMd5` the difficulty is unchanged and osu! knows it as `md5`.
 */
export interface DifficultySource {
  md5: string;
  savedMd5: string;
}

function imported(bytes: Uint8Array): Difficulty {
  const beatmap = parseOsu(new TextDecoder().decode(bytes));
  return { id: uid(), beatmap, source: { md5: md5(bytes), savedMd5: md5Text(serializeBeatmap(beatmap)) } };
}

/** osu!'s checksum for a difficulty as it is now: its original file's while unchanged, else that of the text the editor writes. */
export function checksumOf(savedText: string, source: DifficultySource | undefined): string {
  const saved = md5Text(savedText);
  return source && source.savedMd5 === saved ? source.md5 : saved;
}

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Every non-.osu file in the set (audio, background, custom samples, .osb, video...). */
  files: Map<string, Blob>;
  difficulties: Difficulty[];
  /** For a set published on osu!, what the mirrors serve for it, so cloud sync can leave those files out. */
  origin?: ProjectOrigin;
}

/** The files the beatmap mirrors serve for a published set (see syncpack.ts). */
export interface ProjectOrigin {
  setId: number;
  /** Size and SHA-256 of each non-.osu file, keyed by fileKey(name); null when no mirror had the set. */
  files: Record<string, FileRef> | null;
  checkedAt: number;
}

export interface FileRef {
  size: number;
  sha256: string;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function projectTitle(p: Project): string {
  const m = p.difficulties[0]?.beatmap.metadata;
  if (!m) return 'Untitled';
  const artist = m.artist || m.artistUnicode || 'Unknown artist';
  const title = m.title || m.titleUnicode || 'Untitled';
  return `${artist} - ${title}`;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').trim();
}

export function osuFilename(bm: Beatmap): string {
  const m = bm.metadata;
  return sanitizeFilename(`${m.artist} - ${m.title} (${m.creator}) [${m.version}].osu`);
}

export function oszFilename(p: Project): string {
  const m = p.difficulties[0]?.beatmap.metadata;
  const id = m && m.beatmapSetId > 0 ? `${m.beatmapSetId} ` : '';
  return sanitizeFilename(`${id}${projectTitle(p)}.osz`);
}

export function findFile(p: Project, name: string): Blob | undefined {
  const direct = p.files.get(name);
  if (direct) return direct;
  const lower = name.toLowerCase().replace(/\\/g, '/');
  for (const [k, v] of p.files) if (k.toLowerCase().replace(/\\/g, '/') === lower) return v;
  return undefined;
}

export function uniqueVersionName(p: Project, base: string): string {
  const taken = new Set(p.difficulties.map((d) => d.beatmap.metadata.version.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Import an .osz (or any zip of a beatmap folder). */
export async function importOsz(data: Blob | ArrayBuffer): Promise<Project> {
  const entries = await unpack(data);
  const files = new Map<string, Blob>();
  const difficulties: Difficulty[] = [];
  // Strip a common top-level folder if the zip was made from a folder.
  const prefix = commonPrefix(entries.map((e) => e.name));
  for (const entry of entries) {
    const name = entry.name.slice(prefix.length);
    if (!name) continue;
    if (name.toLowerCase().endsWith('.osu')) difficulties.push(imported(new Uint8Array(await entry.data.arrayBuffer())));
    else files.set(name, entry.data);
  }
  if (difficulties.length === 0) throw new Error('No .osu difficulty found in this package.');
  sortDifficulties(difficulties);
  const now = Date.now();
  return { id: uid(), createdAt: now, updatedAt: now, files, difficulties };
}

/** A package's files, in zip order: read natively when possible (see unzip.ts), else with JSZip. */
async function unpack(data: Blob | ArrayBuffer): Promise<{ name: string; data: Blob }[]> {
  try {
    const entries = await readZip(data instanceof Blob ? data : new Blob([data]));
    if (entries) return await Promise.all(entries.map(async (e) => ({ name: e.name, data: await e.blob(mimeFor(e.name)) })));
  } catch {
    // JSZip may still read it, or says what's wrong with it.
  }
  // Loaded on demand: zips are only read and written on import and export.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  return Promise.all(entries.map(async (f) => ({ name: f.name, data: new Blob([await f.async('arraybuffer')], { type: mimeFor(f.name) }) })));
}

/** Import loose files (a dropped beatmap folder or individual .osu + assets). */
export async function importLooseFiles(list: File[]): Promise<Project> {
  const files = new Map<string, Blob>();
  const difficulties: Difficulty[] = [];
  const prefix = commonPrefix(list.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name));
  for (const f of list) {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).slice(prefix.length);
    if (rel.toLowerCase().endsWith('.osu')) difficulties.push(imported(new Uint8Array(await f.arrayBuffer())));
    else files.set(rel, f);
  }
  if (difficulties.length === 0) throw new Error('No .osu difficulty found among the dropped files.');
  sortDifficulties(difficulties);
  const now = Date.now();
  return { id: uid(), createdAt: now, updatedAt: now, files, difficulties };
}

function commonPrefix(names: string[]): string {
  if (names.length === 0) return '';
  const first = names[0];
  const slash = first.indexOf('/');
  if (slash < 0) return '';
  const candidate = first.slice(0, slash + 1);
  return names.every((n) => n.startsWith(candidate)) ? candidate : '';
}

export function sortDifficulties(d: Difficulty[]) {
  d.sort((a, b) => a.beatmap.general.mode - b.beatmap.general.mode || a.beatmap.difficulty.overallDifficulty - b.beatmap.difficulty.overallDifficulty);
}

/** Start a brand new beatmap from an audio file, like dropping an mp3 onto stable. */
export async function createProjectFromAudio(audio: File, creator: string): Promise<Project> {
  const bm = createEmptyBeatmap();
  const ext = (/\.[a-z0-9]+$/i.exec(audio.name)?.[0] ?? '.mp3').toLowerCase();
  const audioName = `audio${ext}`;
  bm.general.audioFilename = audioName;
  bm.metadata.creator = creator;
  const tags = await readId3(audio).catch(() => null);
  const base = audio.name.replace(/\.[^.]+$/, '');
  const dash = base.indexOf(' - ');
  bm.metadata.artist = tags?.artist || (dash > 0 ? base.slice(0, dash) : '');
  bm.metadata.title = tags?.title || (dash > 0 ? base.slice(dash + 3) : base);
  bm.metadata.artistUnicode = bm.metadata.artist;
  bm.metadata.titleUnicode = bm.metadata.title;
  bm.metadata.version = creator ? `${creator}'s Normal` : 'Normal';
  bm.metadata.tags = '';
  const files = new Map<string, Blob>([[audioName, audio]]);
  if (tags?.picture) {
    const bgName = `bg.${tags.picture.type.includes('png') ? 'png' : 'jpg'}`;
    files.set(bgName, tags.picture);
    bm.events.background = { filename: bgName, x: 0, y: 0 };
  }
  const now = Date.now();
  return { id: uid(), createdAt: now, updatedAt: now, files, difficulties: [{ id: uid(), beatmap: bm }] };
}

export async function exportOsz(p: Project): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [name, blob] of p.files) zip.file(name, blob);
  const used = new Set<string>();
  for (const d of p.difficulties) {
    let name = osuFilename(d.beatmap);
    while (used.has(name.toLowerCase())) name = name.replace(/\.osu$/, '_.osu');
    used.add(name.toLowerCase());
    zip.file(name, serializeBeatmap(d.beatmap));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/x-osu-beatmap-archive' });
}

export function cloneBeatmap(bm: Beatmap): Beatmap {
  return structuredClone(bm);
}

export function mimeFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (
    {
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      mp4: 'video/mp4',
      avi: 'video/x-msvideo',
      flv: 'video/x-flv',
      osb: 'text/plain',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function downloadText(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}
