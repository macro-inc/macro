import { describe, expect, it } from 'vitest';
import { toLeaderboards } from './leaderboards';

describe('toLeaderboards', () => {
  it('projects known games and skips ones this client does not know', () => {
    const leaderboards = toLeaderboards({
      teamId: null,
      games: [
        {
          kind: 'minesweeper',
          scoring: 'low_score',
          entries: [
            {
              userId: 'macro|ann@macro.com',
              rank: 1,
              value: 41_200,
              at: '2026-09-01T12:00:00Z',
            },
          ],
          viewer: null,
        },
        {
          kind: 'chess' as never,
          scoring: 'wins',
          entries: [],
          viewer: null,
        },
      ],
    });

    expect(leaderboards).toEqual({
      teamId: undefined,
      games: {
        minesweeper: {
          kind: 'minesweeper',
          ranking: 'low_score',
          rows: [
            {
              userId: 'macro|ann@macro.com',
              rank: 1,
              value: 41_200,
              at: Date.parse('2026-09-01T12:00:00Z'),
            },
          ],
          viewer: undefined,
        },
      },
    });
  });
});
