import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { usePosthog } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { createSearchParams } from '@app/lib/split-router';
import { TraceFlow, usePending } from '@app/observability/flow';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { onCleanup, Show } from 'solid-js';
import { forYouSearch } from './for-you-search';
import { useIdeas } from './ideas';
import { createIdeasFeed } from './primitives/feed';
import { createLastSeen } from './primitives/last-seen';
import { useIdeasFlag } from './use-ideas-flag';
import { ForYouView } from './views/for-you-view';

function ForYouPage() {
  usePageViewTracking('for-you');
  const [search] = createSearchParams(forYouSearch);
  const { source, actions, userId } = useIdeas();
  const lastSeen = createLastSeen(userId);
  const feed = createIdeasFeed(source, actions, {
    lastSeenAt: lastSeen.before,
    focusedId: () => search.idea,
  });
  usePending('ideas.load', () => feed.view().kind === 'loading');
  // A dismissal held for Undo still has to reach the server if the tab closes.
  window.addEventListener('pagehide', feed.sendDismissals);
  onCleanup(() => window.removeEventListener('pagehide', feed.sendDismissals));

  return (
    <ViewShell.Root aside={false}>
      <ViewShell.Main>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>{t('nav.forYou')}</ViewSidebar.Title>
        </ViewShell.TopBar>
        <ForYouView
          feed={feed}
          actions={actions}
          focusedId={search.idea}
          onRetry={source.retry}
        />
      </ViewShell.Main>
    </ViewShell.Root>
  );
}

/** `/app/for-you`: desktop only, behind `enable-ideas`; otherwise Home. */
export const ForYouRouteView = withAuth(() => {
  const enabled = useIdeasFlag();
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
      <TraceFlow name="ideas.for_you">
        <ForYouPage />
      </TraceFlow>
    </Show>
  );
});
