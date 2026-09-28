import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import type { JSX } from 'solid-js';
import { type GamesContext, GamesProvider } from './context/games-context';
import { reportGameRound, submitGameScore } from './queries/game-results';
import { createLeaderboardsQuerySource } from './queries/leaderboards';
import { publishRoomStatus } from './queries/room-status';

/** Production capabilities: the app's user, names, queries and endpoints. */
function createAppGamesContext(): GamesContext {
  const userId = useUserId();
  return {
    userId,
    displayName: (id) =>
      getDisplayName(tryMacroId(id), { emailFallback: 'local-part' }) || id,
    createLeaderboards: createLeaderboardsQuerySource,
    submitScore: submitGameScore,
    reportRound: reportGameRound,
    publishStatus: publishRoomStatus,
  };
}

/** App-facing entry point: mount game views under the production context. */
export function AppGamesProvider(props: { children: JSX.Element }) {
  return (
    <GamesProvider value={createAppGamesContext()}>
      {props.children}
    </GamesProvider>
  );
}
