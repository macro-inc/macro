import type { GameKind } from './catalog';

export type LeaderboardRanking = 'high_score' | 'low_score' | 'wins';

export type LeaderboardRow = {
  userId: string;
  rank: number;
  /** Best score, or rounds won for win-ranked games. */
  value: number;
  /** When the score was set, or the latest win (epoch ms). */
  at: number;
};

export type GameLeaderboard = {
  kind: GameKind;
  ranking: LeaderboardRanking;
  rows: LeaderboardRow[];
  /** The viewer's own row, even outside the top rows. */
  viewer: LeaderboardRow | undefined;
};

export type Leaderboards = {
  /** Undefined when the viewer has no team and sees only their own results. */
  teamId: string | undefined;
  games: Partial<Record<GameKind, GameLeaderboard>>;
};

/** The team record for a game: the best row, if anyone has played. */
export function teamRecord(
  leaderboards: Leaderboards | undefined,
  kind: GameKind
): LeaderboardRow | undefined {
  return leaderboards?.games[kind]?.rows[0];
}
