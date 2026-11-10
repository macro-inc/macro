import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { createSearchParams } from '@app/lib/split-router';
import { TraceFlow, usePending } from '@app/observability/flow';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableIdeas } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { onCleanup, Show } from 'solid-js';
import { forYouSearch } from './for-you-search';
import { IDEA_ITEM_PARTS } from './idea-items';
import { useIdeas } from './ideas';
import { createIdeasFeed } from './primitives/feed';
import { createLastSeen } from './primitives/last-seen';
import { useIdeasFlag } from './use-ideas-flag';
import { ForYouView } from './views/for-you-view';

function ForYouPage() {
  usePageViewTracking('for-you');
  const [search] = createSearchParams(forYouSearch);
  const { source, actions } = useIdeas();
  const lastSeen = createLastSeen(useUserId());
  const feed = createIdeasFeed(source, actions, {
    lastSeenAt: lastSeen.before,
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
          parts={IDEA_ITEM_PARTS}
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
  const flag = useFeatureFlag(enableIdeas);

  return (
    <Show
      when={enabled()}
      fallback={
        // A flag still loading is not off; a deep link waits for it.
        <Show when={!flag().loading}>
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
