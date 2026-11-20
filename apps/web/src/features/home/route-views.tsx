import type { CalendarPeriodView } from '@app/features/calendar/types';
import { calendarSearch } from '@app/features/calendar-view/calendar-url';
import { channelsSearch } from '@app/features/channels-view/channels-route';
import { driveSearch } from '@app/features/drive-view/primitives/drive-search';
import { createSearchParams, useParams } from '@app/lib/split-router';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { Match, Show, Switch } from 'solid-js';
import { homeRouteShows } from '../new-home/core/new-home-mode';
import { NewHomeRecentView } from '../new-home/new-home-recent';
import { useNewHomeMode } from '../new-home/use-new-home-mode';
import {
  homeCalendarLegacyTarget,
  homeDetailParamsFromRoute,
  homePreviewLegacyTarget,
} from './home-route';
import type { HomePreviewRouteParams } from './home-route-schema';
import { homeProjectSearch } from './home-route-schema';
import { homeTabSearch } from './home-tab-search';
import { HomePendingView, HomeView } from './home-view';

type HomeDetailParams = Partial<HomePreviewRouteParams> & {
  channelId?: string;
  documentType?: string;
  documentId?: string;
  period?: CalendarPeriodView;
};

function HomeLegacyRouteView() {
  const params = useParams<HomeDetailParams>();
  const [channelSearch] = createSearchParams(channelsSearch);
  const [documentSearch] = createSearchParams(driveSearch);
  const [projectSearch] = createSearchParams(homeProjectSearch);
  const [eventSearch] = createSearchParams(calendarSearch);
  const legacyTarget = () => {
    const { period } = params;
    if (period) return homeCalendarLegacyTarget(period, eventSearch);
    const detail = homeDetailParamsFromRoute(params);
    if (!detail) return;
    return homePreviewLegacyTarget(detail, {
      channel: channelSearch,
      document: documentSearch,
      project: projectSearch,
    });
  };

  return (
    <Show when={legacyTarget()}>
      {(target) => <RedirectSplit to={target()} />}
    </Show>
  );
}

export const HomeRouteView = withAuth(() => {
  useViewRestoration();
  const params = useParams<HomeDetailParams>();
  const [tabSearch] = createSearchParams(homeTabSearch);
  const mode = useNewHomeMode();
  const detailRequested = () =>
    homeDetailParamsFromRoute(params) !== undefined ||
    typeof params.period === 'string';

  const shown = () =>
    homeRouteShows({ mode: mode(), recentTab: tabSearch.tab === 'recent' });

  return (
    <Switch>
      <Match when={shown() === 'old'}>
        <AppView
          id="home"
          detailInlineOnly
          detailRequested={detailRequested}
          detailFallback={<HomeLegacyRouteView />}
        >
          <HomeView />
        </AppView>
      </Match>
      <Match when={shown() === 'new'}>
        <AppView
          id="new-home"
          detailInlineOnly
          detailRequested={detailRequested}
          detailFallback={<HomeLegacyRouteView />}
        >
          <NewHomeRecentView />
        </AppView>
      </Match>
      <Match when={shown() === 'pending'}>
        <HomePendingView />
      </Match>
    </Switch>
  );
}, HomePendingView);
