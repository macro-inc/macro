import { useSplitLayout } from '@components/app/split-layout/layout';
import { createSignal } from 'solid-js';
import type { GameKind } from './core/catalog';
import { AppGamesProvider } from './games';
import { isGamesEnabledForCurrentUser } from './games-access';
import { createGameRoom } from './queries/create-game';
import { GamesHubView } from './views/games-hub-view';

/** App-facing Games hub: creates a room and opens it beside the hub. */
export function GamesHub() {
  const { openWithSplit } = useSplitLayout();
  const [creating, setCreating] = createSignal<GameKind>();

  async function create(kind: GameKind) {
    if (creating() || !isGamesEnabledForCurrentUser()) return;
    setCreating(kind);
    try {
      const id = await createGameRoom({ kind, source: 'games_hub' });
      if (!id) return;
      // The kind rides along until the room records it on first open.
      openWithSplit(
        { type: 'game', id, params: { kind } },
        { referredFrom: null, preferNewSplit: true }
      );
    } finally {
      setCreating(undefined);
    }
  }

  return (
    <AppGamesProvider>
      <GamesHubView
        creating={creating()}
        onCreate={(kind) => void create(kind)}
      />
    </AppGamesProvider>
  );
}
