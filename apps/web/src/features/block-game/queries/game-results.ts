import { storageServiceClient } from '@service-storage/client';
import type { RoundOutcome, ScoreOutcome } from '../context/games-context';
import type { GameKind } from '../core/catalog';
import { invalidateLeaderboards } from './leaderboards';

/**
 * Record a finished run. Failures are logged rather than surfaced: a missed
 * leaderboard entry must never interrupt the game itself.
 */
export async function submitGameScore(
  kind: GameKind,
  score: number
): Promise<ScoreOutcome | undefined> {
  const result = await storageServiceClient.games.submitScore({
    kind,
    score: Math.round(score),
  });
  if (result.isErr()) {
    console.error('Failed to submit game score', result.error);
    return undefined;
  }
  if (result.value.improved) void invalidateLeaderboards();
  return { best: result.value.best, improved: result.value.improved };
}

/** Another player's report of the same round usually lands within moments. */
const CONFIRMATION_REFRESH_MS = 5_000;

/**
 * Report a finished round. It counts once two of its players report the same
 * result, so when this report is not the deciding one, the leaderboards
 * refresh a little later, once the other player's report has likely landed.
 */
export async function reportGameRound(outcome: RoundOutcome): Promise<boolean> {
  const result = await storageServiceClient.games.reportRound({
    entityType: 'document',
    entityId: outcome.documentId,
    kind: outcome.kind,
    round: outcome.round,
    winnerUserId: outcome.winner,
    playerUserIds: outcome.players,
  });
  if (result.isErr()) {
    console.error('Failed to report game round', result.error);
    return false;
  }
  if (outcome.winner) {
    if (result.value.recorded) void invalidateLeaderboards();
    else
      setTimeout(() => void invalidateLeaderboards(), CONFIRMATION_REFRESH_MS);
  }
  return true;
}
