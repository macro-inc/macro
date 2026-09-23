import { usePosthog } from '@app/lib/analytics/posthog';
import { defineRoute } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useUserContext } from '@core/context/user';
import { lazy, Show } from 'solid-js';
import type { SetPredicatesInput } from './filters/filter-store/predicates-store';
import type { Query } from './filters/filter-store/types';
import { getViewPreset } from './sidebar/soup-filter-presets';
import { useRecentViewFlag } from './use-recent-view-flag';

const SoupView = lazy(async () => ({
  default: (await import('./soup-view/soup-view')).SoupView,
}));

function TrackedRecentView() {
  usePageViewTracking('recent');
  const preset = getViewPreset('recent');
  return (
    <SoupView
      viewName="Recent"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialClientSort={['touched_at']}
      disableLocalSearch
    />
  );
}

export const RecentRouteView = withAuth(() => {
  const enabled = useRecentViewFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={enabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedRecentView />
    </Show>
  );
});

export const CallsRouteView = withAuth(() => {
  usePageViewTracking('calls');
  const preset = getViewPreset('calls');
  return (
    <SoupView
      viewName="Calls"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
});

export const FoldersRouteView = withAuth(() => {
  usePageViewTracking('folders');
  const user = useUserContext();
  const preset = getViewPreset('folders', undefined, {
    userId: user.userId(),
    isTeamAdmin: false,
  });
  return (
    <SoupView
      viewName="Folders"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
});

type SearchRouteViewParams = {
  initialQuery?: string;
  initialFilters?: Query;
  initialClientFilters?: SetPredicatesInput<string>;
};

export const SearchRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
  const params = (): SearchRouteViewParams => {
    const content = panel.handle.content();
    return content.type === 'component'
      ? ((content.params ?? {}) as SearchRouteViewParams)
      : {};
  };
  usePageViewTracking('search');
  const preset = getViewPreset('search');
  return (
    <SoupView
      viewName="Search"
      initialFilters={params().initialFilters ?? preset?.filters}
      initialClientFilters={
        params().initialClientFilters ?? preset?.clientFilters
      }
      initialSearchText={params().initialQuery}
    />
  );
});

export const recentRoute = defineRoute({
  id: 'view-recent',
  path: 'recent',
  component: RecentRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'recent' }),
});

export const callsRoute = defineRoute({
  id: 'view-calls',
  path: 'calls',
  component: CallsRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'calls' }),
});

export const foldersRoute = defineRoute({
  id: 'view-folders',
  path: 'folders',
  component: FoldersRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'folders' }),
});

export const searchRoute = defineRoute({
  id: 'view-search',
  path: 'search',
  component: SearchRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'search' }),
});
