import type { ModId } from './mods';

export const gameplay = {
  /** Whether a map is being played right now (the volume overlay lets the wheel change the volume then, like stable). */
  active: false,
  /** Mods for the next play only: song select's Ctrl+Enter plays with Autoplay without changing the selection. */
  modsOverride: null as ModId[] | null,
};
