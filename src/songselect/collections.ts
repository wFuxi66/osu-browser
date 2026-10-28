// Stable's collections: named lists of difficulties, kept in this browser.
import { useSyncExternalStore } from 'react';

export interface Collection {
  name: string;
  /** Difficulty ids (they survive edits, unlike stable's md5s). */
  diffs: string[];
}

const KEY = 'osu-web-editor:collections';

function read(): Collection[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c?.name === 'string' && Array.isArray(c.diffs)) : [];
  } catch {
    return [];
  }
}

let cache: Collection[] = read();
const listeners = new Set<() => void>();

function write(next: Collection[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable: the collections stay for this session */
  }
  for (const l of listeners) l();
}

export const collections = {
  all: (): Collection[] => cache,
  has: (name: string) => cache.some((c) => c.name === name),
  /** Adds the difficulty to the collection, or takes it out if it's already in. */
  toggle(name: string, diffId: string) {
    write(cache.map((c) => (c.name !== name ? c : { ...c, diffs: c.diffs.includes(diffId) ? c.diffs.filter((d) => d !== diffId) : [...c.diffs, diffId] })));
  },
  create(name: string, diffs: string[] = []) {
    write([...cache, { name, diffs }].sort((a, b) => a.name.localeCompare(b.name)));
  },
  rename(from: string, to: string) {
    write(cache.map((c) => (c.name === from ? { ...c, name: to } : c)).sort((a, b) => a.name.localeCompare(b.name)));
  },
  remove(name: string) {
    write(cache.filter((c) => c.name !== name));
  },
};

export function useCollections(): Collection[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => cache,
  );
}
