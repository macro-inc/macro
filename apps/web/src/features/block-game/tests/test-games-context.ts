import { createSignal } from 'solid-js';
import type {
  GamesContext,
  RoundOutcome,
  ScoreOutcome,
} from '../context/games-context';
import type { GameKind } from '../core/catalog';
import type { Leaderboards } from '../core/leaderboard';
import type { GameStatus } from '../core/status';

/** A games context with recorded calls and controllable leaderboards. */
export function createTestGamesContext(
  overrides: { userId?: string; leaderboards?: Leaderboards } = {}
) {
  const [leaderboards, setLeaderboards] = createSignal<
    Leaderboards | undefined
  >(overrides.leaderboards);
  const scores: { kind: GameKind; score: number }[] = [];
  const rounds: RoundOutcome[] = [];
  const statuses: { documentId: string; status: GameStatus }[] = [];
  const context: GamesContext = {
    userId: () => overrides.userId,
    displayName: (userId) => userId.replace(/^macro\|/, '').split('@')[0],
    createLeaderboards: () => ({
      leaderboards,
      isLoading: () => false,
      error: () => undefined,
    }),
    submitScore: async (kind, score): Promise<ScoreOutcome> => {
      scores.push({ kind, score });
      return { best: score, improved: true };
    },
    reportRound: async (outcome) => {
      rounds.push(outcome);
      return true;
    },
    publishStatus: async (documentId, status) => {
      statuses.push({ documentId, status });
      return true;
    },
  };
  return { context, scores, rounds, statuses, setLeaderboards };
}
