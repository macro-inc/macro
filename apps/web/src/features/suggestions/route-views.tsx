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
import { enableSuggestions } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { onCleanup, Show } from 'solid-js';
import { forYouSearch } from './for-you-search';
import { createSuggestionsFeed } from './primitives/feed';
import { createRefresh } from './primitives/refresh';
import { SUGGESTION_ITEM_PARTS } from './suggestion-items';
import { useSuggestions } from './suggestions';
import { useSuggestionsFlag } from './use-suggestions-flag';
import { ForYouView } from './views/for-you-view';

function ForYouPage() {
  usePageViewTracking('for-you');
  const [search] = createSearchParams(forYouSearch);
  const { source, generation, actions } = useSuggestions();
  const refresh = createRefresh(generation);
  const feed = createSuggestionsFeed(source, actions, { viewer: useUserId() });
  usePending('suggestions.load', () => feed.view().kind === 'loading');
  // Leaving the page is when the person has looked: what comes after is new.
  window.addEventListener('pagehide', source.viewed);
  onCleanup(() => {
    window.removeEventListener('pagehide', source.viewed);
    source.viewed();
  });

  return (
    <ViewShell.Root aside={false}>
      <ViewShell.Main>
        <ViewShell.TopBar>
          <ViewSidebar.Title caret={false}>{t('nav.forYou')}</ViewSidebar.Title>
        </ViewShell.TopBar>
        <ForYouView
          feed={feed}
          actions={actions}
          parts={SUGGESTION_ITEM_PARTS}
          refresh={refresh}
          focusedId={search.suggestion}
          onRetry={source.retry}
        />
      </ViewShell.Main>
    </ViewShell.Root>
  );
}

/** `/app/for-you`: desktop only, behind `enable-suggestions`; otherwise Home. */
export const ForYouRouteView = withAuth(() => {
  const enabled = useSuggestionsFlag();
  const flag = useFeatureFlag(enableSuggestions);

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
      <TraceFlow name="suggestions.for_you">
        <ForYouPage />
      </TraceFlow>
    </Show>
  );
});
