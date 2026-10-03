import { ViewTour } from '@app/features/tours/ViewTour';
import { usePosthog } from '@app/lib/analytics/posthog';
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
import { callsTour, foldersTour } from './tour';
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
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
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
      tour={<ViewTour tour={callsTour} />}
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
      tour={<ViewTour tour={foldersTour} />}
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
