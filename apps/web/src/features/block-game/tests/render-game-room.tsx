import { render } from '@solidjs/testing-library';
import { GamesProvider } from '../context/games-context';
import type { GameKind } from '../core/catalog';
import { ensureGameMeta } from '../core/game-document';
import { createGameRoom } from '../primitives/create-game-room';
import { GameRoomView } from '../views/game-room-view';
import { createFakeRoomSource } from './fake-room-source';
import { createTestGamesContext } from './test-games-context';

export const TEST_ROOM_ID = 'room-1';

/** Render a room as `userId` over an in-memory document and test context. */
export function renderGameRoom(options: {
  userId: string;
  canEdit?: boolean;
  ready?: boolean;
  kind?: GameKind;
}) {
  const fake = createFakeRoomSource({ ready: options.ready });
  if (options.kind) ensureGameMeta(fake.doc, options.kind);
  const games = createTestGamesContext({ userId: options.userId });
  render(() => {
    const room = createGameRoom({
      source: fake.source,
      userId: games.context.userId,
      canEdit: () => options.canEdit ?? true,
      requestedKind: () => undefined,
    });
    return (
      <GamesProvider value={games.context}>
        <GameRoomView room={room} documentId={TEST_ROOM_ID} />
      </GamesProvider>
    );
  });
  return { fake, games };
}
