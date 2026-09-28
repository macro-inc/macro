import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamesProvider } from '../context/games-context';
import type { GameKind } from '../core/catalog';
import type { Leaderboards } from '../core/leaderboard';
import { createTestGamesContext } from '../tests/test-games-context';
import { TeamLeaderboardPanel } from './team-leaderboard-panel';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const ANN = 'macro|ann@macro.com';
const BOB = 'macro|bob@macro.com';

afterEach(cleanup);

function renderPanel(kind: GameKind, leaderboards: Leaderboards) {
  const games = createTestGamesContext({ userId: ANN, leaderboards });
  render(() => (
    <GamesProvider value={games.context}>
      <TeamLeaderboardPanel kind={kind} />
    </GamesProvider>
  ));
  return games;
}

const rowTexts = () =>
  [...document.querySelectorAll('li')].map((row) => row.textContent);

describe('TeamLeaderboardPanel', () => {
  it('ranks the team and keeps the viewer visible below the top rows', () => {
    renderPanel('snake', {
      teamId: 'team-1',
      games: {
        snake: {
          kind: 'snake',
          ranking: 'high_score',
          rows: [{ userId: BOB, rank: 1, value: 1_250, at: 0 }],
          viewer: { userId: ANN, rank: 12, value: 40, at: 0 },
        },
      },
    });
    expect(screen.getByText('Team high scores')).toBeTruthy();
    expect(rowTexts()).toEqual(['1bob1,250', '⋯', '12ann40']);
  });

  it('counts wins, and falls back to personal results without a team', () => {
    renderPanel('connect_four', {
      teamId: undefined,
      games: {
        connect_four: {
          kind: 'connect_four',
          ranking: 'wins',
          rows: [{ userId: ANN, rank: 1, value: 1, at: 0 }],
          viewer: { userId: ANN, rank: 1, value: 1, at: 0 },
        },
      },
    });
    expect(screen.getByText('Your wins')).toBeTruthy();
    expect(rowTexts()).toEqual(['1ann1 win']);
  });

  it('invites the first record when nobody has played', () => {
    renderPanel('minesweeper', { teamId: 'team-1', games: {} });
    expect(
      screen.getByText('No results yet. Set the first record!')
    ).toBeTruthy();
  });
});
