// Beatmap downloads run in the background like stable's osu!direct: a toast shows the progress and the game stays
// usable meanwhile (a set with a video or a storyboard can take minutes).
import { editor } from '../editor/store';
import type { Project } from './project';

const running = new Set<string>();

/**
 * Runs a download under a progress toast. `key` stops the same download starting twice. Resolves with the project,
 * or null when it failed (the error is shown) or was already running.
 */
export async function downloadInBackground(
  key: string,
  label: string,
  fn: (progress: (fraction: number) => void) => Promise<Project>,
): Promise<Project | null> {
  if (running.has(key)) {
    editor.toast(`${label} is already downloading.`);
    return null;
  }
  running.add(key);
  const toast = editor.stickyToast(`Downloading ${label}…`);
  let shown = 0;
  try {
    return await fn((f) => {
      // Keep updates to a few per second.
      if (f - shown < 0.02 && f < 1) return;
      shown = f;
      toast.update(`Downloading ${label}… ${Math.round(f * 100)}%`);
    });
  } catch (e) {
    editor.toast(`${label}: ${(e as Error).message}`, 'error');
    return null;
  } finally {
    running.delete(key);
    toast.close();
  }
}
