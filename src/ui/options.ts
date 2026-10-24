// Whether the Options panel is open (and on which section), shared by song select, the editor and the panel itself.
import { useSyncExternalStore } from 'react';

export type OptionsSection = 'general' | 'audio' | 'skin' | 'editor' | 'downloads' | 'input';

let state: { open: boolean; section: OptionsSection; rev: number } = { open: false, section: 'general', rev: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<typeof state>) {
  state = { ...state, ...next, rev: state.rev + 1 };
  for (const l of listeners) l();
}

export const options = {
  show(section?: OptionsSection) {
    set({ open: true, ...(section ? { section } : {}) });
  },
  hide() {
    set({ open: false });
  },
  toggle() {
    set({ open: !state.open });
  },
  /** Scrolls to a section (the panel listens for rev changes). */
  goto(section: OptionsSection) {
    set({ section });
  },
};

/** True while the panel is open: song select and the editor leave keys to it then. */
export function optionsOpen(): boolean {
  return state.open;
}

export function useOptions() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
