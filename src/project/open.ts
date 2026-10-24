// Getting beatmaps into the app: dropped/picked files, folders and osu.ppy.sh links.
import { editor } from '../editor/store';
import { cloud } from './cloud';
import { createProjectFromAudio, importLooseFiles, importOsz, type Project } from './project';
import { saveProjectLocal } from './storage';

export const AUDIO_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;

export type OpenResult = { kind: 'created' | 'imported'; project: Project };

/**
 * Turn dropped or picked files into a stored project. An audio file starts a new beatmap; an .osz, a beatmap
 * folder or loose .osu files are imported.
 */
export async function projectFromFiles(files: File[]): Promise<OpenResult> {
  if (files.length === 0) throw new Error('Nothing to open.');
  const osz = files.find((f) => /\.(osz|zip)$/i.test(f.name));
  const hasOsu = files.some((f) => /\.osu$/i.test(f.name));
  let project: Project;
  let kind: OpenResult['kind'] = 'imported';
  if (osz) project = await importOsz(osz);
  else if (hasOsu) project = await importLooseFiles(files);
  else {
    const audio = files.find((f) => AUDIO_RE.test(f.name) || f.type.startsWith('audio/'));
    if (!audio) throw new Error('Drop an audio file (mp3/ogg), an .osz, or a beatmap folder.');
    project = await createProjectFromAudio(audio, cloud.user?.username || editor.prefs.creatorName);
    kind = 'created';
  }
  await saveProjectLocal(project);
  return { kind, project };
}

/** A new beatmap opens straight into the editor with Song Setup, like dropping an mp3 onto stable. */
export async function openNewBeatmap(project: Project) {
  await editor.openProject(project);
  editor.openDialog('setup');
}

/** Download a published set by link or id and store it. */
export async function projectFromLink(link: string, onProgress?: (fraction: number) => void): Promise<Project> {
  const m = /(?:beatmapsets\/|^)(\d+)/.exec(link.trim());
  if (!m) throw new Error('Paste a beatmapset link like https://osu.ppy.sh/beatmapsets/123456 or just the set id.');
  const setId = Number(m[1]);
  const data = await cloud.fetchBeatmapset(setId, onProgress);
  const p = await importOsz(data);
  // Old .osu files have no BeatmapSetID line; we know it from the download.
  for (const d of p.difficulties) if (!(d.beatmap.metadata.beatmapSetId > 0)) d.beatmap.metadata.beatmapSetId = setId;
  await saveProjectLocal(p);
  return p;
}

/** Collect files from a drop, including whole folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (items.length === 0) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name });
      out.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length > 0);
    }
  };
  for (const it of items) await walk(it, '');
  return out;
}

export function pickFiles(accept: string, opts: { multiple?: boolean; directory?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = !!opts.multiple;
    if (opts.directory) input.setAttribute('webkitdirectory', '');
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}
