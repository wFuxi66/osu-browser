// Getting beatmaps into the app: dropped/picked files, folders and osu.ppy.sh links.
import { editor } from '../editor/store';
import { md5Text } from '../osu/md5';
import { serializeBeatmap } from '../osu/serializer';
import { cloud } from './cloud';
import { createProjectFromAudio, importLooseFiles, importOsz, type Project } from './project';
import { onlineSet, type OnlineSet } from './online';
import { listProjectsLocal, loadProjectLocal, saveProjectLocal, trashProjectLocal } from './storage';
import { originOf, setIdOf } from './syncpack';

export const AUDIO_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;

export type OpenResult = { kind: 'created' | 'imported'; project: Project; replaced?: number };

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
  // Like stable, an imported set replaces the copy already in song select (which would read as an old version),
  // but into Recently deleted rather than overwritten, so local edits can be restored.
  const setId = kind === 'imported' ? setIdOf(project) : 0;
  const old = setId > 0 ? (await listProjectsLocal()).filter((p) => p.beatmapSetId === setId && p.id !== editor.project?.id) : [];
  for (const p of old) await trashProjectLocal(p.id);
  await saveProjectLocal(project);
  return { kind, project, replaced: old.length };
}

/** A new beatmap opens straight into the editor with Song Setup, like dropping an mp3 onto stable. */
export async function openNewBeatmap(project: Project) {
  await editor.openProject(project);
  editor.openDialog('setup');
}

/**
 * Old .osu files have no BeatmapSetID line; we know it from the download. Filling it in isn't an edit: the
 * difficulty is still the file osu! has (see DifficultySource).
 */
function fillSetId(p: Project, setId: number) {
  for (const d of p.difficulties) {
    if (d.beatmap.metadata.beatmapSetId > 0) continue;
    d.beatmap.metadata.beatmapSetId = setId;
    if (d.source) d.source.savedMd5 = md5Text(serializeBeatmap(d.beatmap));
  }
}

/** The set id in an osu.ppy.sh beatmapset link (or a bare id), or null. */
export function linkSetId(link: string): number | null {
  const m = /(?:beatmapsets\/|^)(\d+)/.exec(link.trim());
  return m ? Number(m[1]) : null;
}

/**
 * Download a set, preferring a mirror that has the version osu! has now (`online`; null takes whatever the mirrors
 * have). `current` says whether it got that version.
 */
async function downloadSet(
  setId: number,
  online: OnlineSet | null,
  onProgress?: (fraction: number) => void,
  video = true,
): Promise<{ project: Project; current: boolean }> {
  const checksums = online && new Set(online.beatmaps.map((b) => b.checksum));
  const isCurrent = (p: Project) => !checksums || p.difficulties.every((d) => d.source && checksums.has(d.source.md5));
  const parsed = new Map<ArrayBuffer, Project>();
  const data = await cloud.fetchBeatmapset(setId, onProgress, video, async (d) => {
    const p = await importOsz(d);
    parsed.set(d, p);
    return isCurrent(p);
  });
  const project = parsed.get(data) ?? (await importOsz(data));
  return { project, current: isCurrent(project) };
}

/** Download a published set by link or id and store it. */
export async function projectFromLink(link: string, onProgress?: (fraction: number) => void, video = true): Promise<Project> {
  const setId = linkSetId(link);
  if (setId === null) throw new Error('Paste a beatmapset link like https://osu.ppy.sh/beatmapsets/123456 or just the set id.');
  const online = await onlineSet(setId, true).catch(() => null);
  const { project: p } = await downloadSet(setId, online, onProgress, video);
  fillSetId(p, setId);
  // These are exactly the mirror's files, so cloud sync can leave them out without asking the mirror again.
  p.origin = await originOf(setId, p.files);
  await saveProjectLocal(p);
  return p;
}

/**
 * Song select's "Update to latest version": replaces a stored set with the version on osu! (downloaded from the
 * mirrors), dropping all local changes like stable does. Nothing changes if no mirror has that version yet.
 */
export async function updateToLatest(projectId: string, setId: number, onProgress?: (fraction: number) => void): Promise<Project> {
  const online = await onlineSet(setId, true);
  if (!online) throw new Error('This beatmap set is no longer on osu!.');
  const { project: latest, current } = await downloadSet(setId, online, onProgress);
  if (!current) {
    throw new Error("The download mirrors don't have the latest version of this set yet, so nothing was changed. Try again in a while, or download it on osu! and drop the .osz here.");
  }
  const p = await loadProjectLocal(projectId);
  if (!p) throw new Error('This beatmap is no longer in song select.');
  // The download runs in the background: saving a set opened meanwhile would undo the update.
  if (editor.project?.id === projectId) throw new Error('It was opened in the editor while downloading, so nothing was changed. Close it and update again.');
  fillSetId(latest, setId);
  p.files = latest.files;
  p.difficulties = latest.difficulties;
  p.origin = await originOf(setId, latest.files);
  p.updatedAt = Date.now();
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
