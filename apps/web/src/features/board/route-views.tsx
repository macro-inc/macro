import { usePosthog } from '@app/lib/analytics/posthog';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { useBoardFlag } from './use-board-flag';

const BoardEntry = lazy(async () => ({
  default: (await import('./board')).BoardEntry,
}));

function TrackedBoard() {
  usePageViewTracking('board');
  return <BoardEntry />;
}

/** `/board`; with the flag off a deep link goes Home once flags load. */
export const BoardRouteView = withAuth(() => {
  const enabled = useBoardFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={enabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <TrackedBoard />
    </Show>
  );
});
