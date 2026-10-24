// What cloud sync uploads. A set that's published on osu! (BeatmapSetID > 0) goes up as a "lite" package:
// its .osu files, any file that differs from what the mirrors serve for the set, and a manifest naming the
// files to take from the mirror's copy when the package is restored on another device. That keeps audio,
// backgrounds and videos of published sets out of cloud storage. Original maps upload the whole set.
import { exportOsz, importOsz, type FileRef, type Project, type ProjectOrigin } from './project';

export const MANIFEST = '.osu-web-editor-sync.json';

interface Manifest {
  version: 1;
  beatmapSetId: number;
  /** Files to take from the mirror's copy of the set, by their name in the project. */
  mirrorFiles: Record<string, FileRef>;
}

export function setIdOf(p: Project): number {
  return p.difficulties.find((d) => d.beatmap.metadata.beatmapSetId > 0)?.beatmap.metadata.beatmapSetId ?? 0;
}

/** Beatmap folder paths are case-insensitive on Windows, where osu! runs. */
export function fileKey(name: string): string {
  return name.toLowerCase().replace(/\\/g, '/');
}

// Blobs don't change, so each is hashed once (the editor keeps the same Blob objects between saves).
const hashes = new WeakMap<Blob, Promise<string>>();

export function sha256(b: Blob): Promise<string> {
  let h = hashes.get(b);
  if (!h) {
    h = b.arrayBuffer().then(async (buf) => {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      return Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('');
    });
    hashes.set(b, h);
  }
  return h;
}

export async function originOf(setId: number, files: Map<string, Blob>): Promise<ProjectOrigin> {
  const refs: Record<string, FileRef> = {};
  for (const [name, blob] of files) refs[fileKey(name)] = { size: blob.size, sha256: await sha256(blob) };
  return { setId, files: refs, checkedAt: Date.now() };
}

/** The package to upload: lite when the project knows what the mirrors serve for its set, otherwise the full .osz. */
export async function buildSyncPackage(p: Project): Promise<Blob> {
  const setId = setIdOf(p);
  const origin = p.origin?.setId === setId ? p.origin.files : null;
  if (!(setId > 0) || !origin) return exportOsz(p);
  const mirrorFiles: Record<string, FileRef> = {};
  const own = new Map<string, Blob>();
  for (const [name, blob] of p.files) {
    const ref = origin[fileKey(name)];
    if (ref && ref.size === blob.size && ref.sha256 === (await sha256(blob))) mirrorFiles[name] = ref;
    else own.set(name, blob);
  }
  if (Object.keys(mirrorFiles).length === 0) return exportOsz(p);
  const manifest: Manifest = { version: 1, beatmapSetId: setId, mirrorFiles };
  own.set(MANIFEST, new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
  return exportOsz({ ...p, files: own });
}

/**
 * Turns a downloaded package back into a project. A lite package gets its remaining files from the mirror's
 * copy of the set; the warnings name files the mirror no longer serves as they were (the set was updated).
 */
export async function restoreSyncPackage(
  data: ArrayBuffer,
  fetchSet: (setId: number) => Promise<ArrayBuffer>,
): Promise<{ project: Project; warnings: string[] }> {
  const p = await importOsz(data);
  const manifestFile = p.files.get(MANIFEST);
  if (!manifestFile) return { project: p, warnings: [] };
  p.files.delete(MANIFEST);
  const m = JSON.parse(await manifestFile.text()) as Manifest;
  const mirror = await importOsz(await fetchSet(m.beatmapSetId));
  const byKey = new Map([...mirror.files].map(([name, blob]) => [fileKey(name), blob]));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [name, ref] of Object.entries(m.mirrorFiles)) {
    const blob = byKey.get(fileKey(name));
    if (!blob) {
      missing.push(name);
      continue;
    }
    p.files.set(name, blob);
    if (blob.size !== ref.size || (await sha256(blob)) !== ref.sha256) changed.push(name);
  }
  p.origin = await originOf(m.beatmapSetId, mirror.files);
  const warnings: string[] = [];
  const list = (names: string[]) => names.join(', ');
  if (missing.length) warnings.push(`the mirrors' copy of set ${m.beatmapSetId} no longer has ${list(missing)}`);
  if (changed.length) warnings.push(`${list(changed)} changed on osu! since this was synced (the set was updated), so you have the new version`);
  return { project: p, warnings };
}
