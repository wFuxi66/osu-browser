import { describe, expect, it, vi } from 'vitest';

vi.mock('../editor/store', () => ({ editor: {} }));
vi.mock('./cloud', () => ({ cloud: {} }));
vi.mock('./open', () => ({}));
vi.mock('./storage', () => ({}));

const { parseMapLink } = await import('./deeplink');

describe('parseMapLink', () => {
  it('reads the set and the difficulty picked on the beatmap page', () => {
    expect(parseMapLink('/beatmapsets/1234', '#osu/5678')).toEqual({ setId: 1234, beatmapId: 5678 });
    expect(parseMapLink('/beatmapsets/1234', '#mania/9')).toEqual({ setId: 1234, beatmapId: 9 });
    expect(parseMapLink('/beatmapsets/1234/', '')).toEqual({ setId: 1234, beatmapId: 0 });
  });

  it('reads discussion pages, which name the difficulty in the path', () => {
    expect(parseMapLink('/beatmapsets/1234/discussion/5678/timeline', '')).toEqual({ setId: 1234, beatmapId: 5678 });
    expect(parseMapLink('/beatmapsets/1234/discussion', '')).toEqual({ setId: 1234, beatmapId: 0 });
  });

  it('ignores other paths', () => {
    expect(parseMapLink('/', '')).toBeNull();
    expect(parseMapLink('/beatmapsets', '')).toBeNull();
    expect(parseMapLink('/beatmapsets/12abc', '')).toBeNull();
    expect(parseMapLink('/beatmaps/5678', '')).toBeNull();
  });
});
