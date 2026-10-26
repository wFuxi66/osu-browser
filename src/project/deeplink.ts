// osu.ppy.sh beatmap paths on this site (/beatmapsets/123#osu/456, what the userscript and bookmarklet link to)
// open that set in the editor: song select's copy if it has one, otherwise downloaded from the mirrors.
import { editor } from '../editor/store';
import { screens } from '../ui/screens';
import { cloud } from './cloud';
import { projectFromLink } from './open';
import { listProjectsLocal, loadProjectLocal } from './storage';

export interface MapLink {
  setId: number;
  /** The difficulty picked on the beatmap page, or 0. */
  beatmapId: number;
}

/** Any page of a set (its info page, discussion…) works; the hash says which difficulty is picked. */
export function parseMapLink(pathname: string, hash: string): MapLink | null {
  const set = /^\/beatmapsets\/(\d+)(?:\/|$)/.exec(pathname);
  if (!set) return null;
  const diff = /^#(?:osu|taiko|fruits|mania)\/(\d+)/.exec(hash) ?? /^\/beatmapsets\/\d+\/discussion\/(\d+)/.exec(pathname);
  return { setId: Number(set[1]), beatmapId: diff ? Number(diff[1]) : 0 };
}

/** Reads a map link from the address bar (and clears it, so a reload doesn't open the map again). */
export function takeMapLink(): MapLink | null {
  const link = parseMapLink(location.pathname, location.hash);
  if (link) history.replaceState(history.state, '', '/' + location.search);
  return link;
}

export async function openMapLink(link: MapLink) {
  // Song select in edit mode is where Esc leads from the editor.
  screens.select('edit');
  const status = editor.stickyToast('Opening beatmap…');
  try {
    // A set synced from another computer may only be on Drive so far: fetch it rather than download a second copy.
    if (cloud.syncing) {
      status.update('Syncing with Google Drive…');
      await cloud.syncAll().catch(() => 0);
    }
    // Newest first, so a set imported twice opens the copy last worked on.
    const local = (await listProjectsLocal()).find((p) => p.beatmapSetId === link.setId);
    let project = local ? await loadProjectLocal(local.id) : null;
    if (!project) {
      let shown = 0;
      project = await projectFromLink(
        String(link.setId),
        (f) => {
          if (f - shown < 0.02 && f < 1) return;
          shown = f;
          status.update(`Downloading beatmap… ${Math.round(f * 100)}%`);
        },
        editor.prefs.downloadVideo,
      );
    }
    const diff = project.difficulties.findIndex((d) => d.beatmap.metadata.beatmapId === link.beatmapId);
    await editor.openProject(project, Math.max(0, diff));
  } catch (e) {
    editor.toast(`Couldn't open beatmap ${link.setId}: ${(e as Error).message}`, 'error');
  } finally {
    status.close();
  }
}
