// What osu! knows about a published set, for song select's status box ("Latest ranked version", "Update to
// latest version", "Not submitted"), like stable's. Asks our API (the official osu! API) and falls back to
// osu.direct's copy of it.

export interface OnlineBeatmap {
  id: number;
  checksum: string;
  status: string;
  version: string;
}

export interface OnlineSet {
  status: string;
  beatmaps: OnlineBeatmap[];
}

export type MapStatus = { kind: 'latest'; status: string } | { kind: 'update' } | { kind: 'unsubmitted' };

const TTL = 5 * 60 * 1000;
const cache = new Map<number, { at: number; set: Promise<OnlineSet | null> }>();

/** The set as osu! has it, null if osu! doesn't know it. Rejects when neither source answers. */
export function onlineSet(setId: number, fresh = false): Promise<OnlineSet | null> {
  const hit = cache.get(setId);
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.set;
  const set = fetchSet(setId);
  cache.set(setId, { at: Date.now(), set });
  set.catch(() => cache.delete(setId));
  return set;
}

async function fetchSet(setId: number): Promise<OnlineSet | null> {
  try {
    const r = await fetch(`/api/beatmapsets/${setId}`);
    if (r.ok && r.headers.get('content-type')?.includes('json')) {
      const s = (await r.json()) as { found: boolean } & OnlineSet;
      return s.found ? { status: s.status, beatmaps: s.beatmaps } : null;
    }
  } catch {
    // no backend: try the mirror
  }
  const r = await fetch(`https://osu.direct/api/v2/s/${setId}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`osu.direct: HTTP ${r.status}`);
  const s = (await r.json()) as { status: string; beatmaps?: OnlineBeatmap[] };
  return { status: s.status, beatmaps: (s.beatmaps ?? []).map((b) => ({ id: b.id, checksum: b.checksum, status: b.status, version: b.version })) };
}

/**
 * Stable's status for a difficulty with this checksum and BeatmapID: the latest version, an older or edited one, or
 * unknown to osu!. A difficulty added to a published set (BeatmapID 0, or an id the set doesn't have) was never
 * uploaded, so there's no version to update to: it's "Not submitted".
 */
export function mapStatus(checksum: string, beatmapId: number, set: OnlineSet | null): MapStatus {
  if (!set) return { kind: 'unsubmitted' };
  const same = set.beatmaps.find((b) => b.checksum === checksum);
  if (same) return { kind: 'latest', status: same.status || set.status };
  return beatmapId > 0 && set.beatmaps.some((b) => b.id === beatmapId) ? { kind: 'update' } : { kind: 'unsubmitted' };
}

/** "Latest ranked version" and so on; graveyarded and WIP maps read as pending, as in stable. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'ranked':
    case 'approved':
      return 'Latest ranked version';
    case 'qualified':
      return 'Latest qualified version';
    case 'loved':
      return 'Latest loved version';
    default:
      return 'Latest pending version';
  }
}
