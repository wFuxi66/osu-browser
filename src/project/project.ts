import JSZip from 'jszip';
import { parseOsu } from '../osu/parser';
import { serializeBeatmap } from '../osu/serializer';
import { createEmptyBeatmap, type Beatmap } from '../osu/types';
import { readId3 } from './id3';

export interface Difficulty {
  id: string;
  beatmap: Beatmap;
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
  const zip = await JSZip.loadAsync(data);
  const files = new Map<string, Blob>();
  const difficulties: Difficulty[] = [];
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  // Strip a common top-level folder if the zip was made from a folder.
  const prefix = commonPrefix(entries.map((e) => e.name));
  for (const entry of entries) {
    const name = entry.name.slice(prefix.length);
    if (!name) continue;
    if (name.toLowerCase().endsWith('.osu')) {
      const text = await entry.async('string');
      difficulties.push({ id: uid(), beatmap: parseOsu(text) });
    } else {
      files.set(name, new Blob([await entry.async('arraybuffer')], { type: mimeFor(name) }));
    }
  }
  if (difficulties.length === 0) throw new Error('No .osu difficulty found in this package.');
  sortDifficulties(difficulties);
  const now = Date.now();
  return { id: uid(), createdAt: now, updatedAt: now, files, difficulties };
}

/** Import loose files (a dropped beatmap folder or individual .osu + assets). */
export async function importLooseFiles(list: File[]): Promise<Project> {
  const files = new Map<string, Blob>();
  const difficulties: Difficulty[] = [];
  const prefix = commonPrefix(list.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name));
  for (const f of list) {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).slice(prefix.length);
    if (rel.toLowerCase().endsWith('.osu')) difficulties.push({ id: uid(), beatmap: parseOsu(await f.text()) });
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
