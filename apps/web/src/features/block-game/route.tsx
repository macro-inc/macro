import { defineRoute } from '@app/lib/split-router';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { useGamesAccess } from './games-access';

const GamesHub = lazy(async () => ({
  default: (await import('./games-hub')).GamesHub,
}));

function TrackedGamesView() {
  usePageViewTracking('games');
  const enabled = useGamesAccess();
  return (
    <Show
      when={enabled()}
      fallback={
        <div class="p-6 text-ink-muted">
          Games are not enabled for this account.
        </div>
      }
    >
      <GamesHub />
    </Show>
  );
}

export const GamesRouteView = withAuth(TrackedGamesView);

export const gamesSplitRoute = defineRoute({
  id: 'view-games',
  path: 'games',
  component: GamesRouteView,
});
