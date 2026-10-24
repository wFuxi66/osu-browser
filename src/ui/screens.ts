// Which screen is showing when no map is open: stable's main menu, or song select in play or edit mode.
import { useSyncExternalStore } from 'react';

export type SelectMode = 'play' | 'edit';

interface State {
  screen: 'menu' | 'select';
  mode: SelectMode;
  /** Open osu!direct when song select appears (the main menu's osu!direct tab). */
  direct: boolean;
}

let state: State = { screen: 'menu', mode: 'edit', direct: false };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const screens = {
  get: () => state,
  menu: () => set({ screen: 'menu', direct: false }),
  select: (mode: SelectMode, direct = false) => set({ screen: 'select', mode, direct }),
  /** Song select took the osu!direct request. */
  directOpened: () => set({ direct: false }),
};

export function useScreens(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
