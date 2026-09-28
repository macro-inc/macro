import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import { storageServiceClient } from '@service-storage/client';
import type { GameLeaderboards } from '@service-storage/generated/schemas/gameLeaderboards';
import type { LeaderboardEntry } from '@service-storage/generated/schemas/leaderboardEntry';
import { useQuery } from '@tanstack/solid-query';
import { match } from 'ts-pattern';
import type { LeaderboardsSource } from '../context/games-context';
import { isGameKind } from '../core/catalog';
import type {
  GameLeaderboard,
  LeaderboardRanking,
  LeaderboardRow,
  Leaderboards,
} from '../core/leaderboard';
import { gamesKeys } from './keys';

function toRow(entry: LeaderboardEntry): LeaderboardRow {
  return {
    userId: entry.userId,
    rank: entry.rank,
    value: entry.value,
    at: Date.parse(entry.at),
  };
}

/** Project the API response onto the feature's leaderboard model. */
export function toLeaderboards(response: GameLeaderboards): Leaderboards {
  const games: Leaderboards['games'] = {};
  for (const game of response.games) {
    // A newer backend may rank games this client does not know yet.
    if (!isGameKind(game.kind)) continue;
    const ranking = match(game.scoring)
      .returnType<LeaderboardRanking>()
      .with('high_score', () => 'high_score')
      .with('low_score', () => 'low_score')
      .with('wins', () => 'wins')
      .exhaustive();
    const board: GameLeaderboard = {
      kind: game.kind,
      ranking,
      rows: game.entries.map(toRow),
      viewer: game.viewer ? toRow(game.viewer) : undefined,
    };
    games[game.kind] = board;
  }
  return { teamId: response.teamId ?? undefined, games };
}

/** Team leaderboards for every game, shared by every panel through the cache. */
export function createLeaderboardsQuerySource(): LeaderboardsSource {
  const query = useQuery(() => ({
    queryKey: gamesKeys.leaderboards.queryKey,
    queryFn: async () =>
      toLeaderboards(
        await throwOnErr(() => storageServiceClient.games.leaderboards())
      ),
    staleTime: 30_000,
    retry: false,
  }));
  return {
    leaderboards: () => (queryReadyGate(query) ? query.data : undefined),
    isLoading: () => query.isLoading,
    error: () => query.error ?? undefined,
  };
}

export function invalidateLeaderboards() {
  return queryClient.invalidateQueries({
    queryKey: gamesKeys.leaderboards.queryKey,
  });
}
