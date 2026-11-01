import { describe, expect, it } from 'vitest';
import { createEmptyBeatmap } from '../osu/types';
import { keepDifficultyIds, type Difficulty, type Project } from './project';

function diff(id: string, beatmapId: number, version: string): Difficulty {
  const beatmap = createEmptyBeatmap();
  beatmap.metadata.beatmapId = beatmapId;
  beatmap.metadata.version = version;
  return { id, beatmap };
}

describe('keepDifficultyIds', () => {
  it('matches by BeatmapID, then by name, and leaves new difficulties their own id', () => {
    const next = [diff('n1', 1, 'Renamed'), diff('n2', 0, 'Unsubmitted'), diff('n3', 3, 'Added on osu!'), diff('n4', 0, 'Insane')];
    const old = [diff('old-insane', 2, 'Insane'), diff('old-1', 1, 'Hard'), diff('old-un', 0, 'Unsubmitted')];
    keepDifficultyIds({ difficulties: next } as Project, old);
    expect(next.map((d) => d.id)).toEqual(['old-1', 'old-un', 'n3', 'old-insane']);
  });

  it('gives no id out twice', () => {
    const next = [diff('n1', 0, 'Hard'), diff('n2', 0, 'Hard')];
    keepDifficultyIds({ difficulties: next } as Project, [diff('old', 0, 'Hard')]);
    expect(next.map((d) => d.id)).toEqual(['old', 'n2']);
  });
});
