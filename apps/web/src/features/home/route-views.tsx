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
import { Show } from 'solid-js';
import {
  homeCalendarLegacyTarget,
  homeDetailParamsFromRoute,
  homePreviewLegacyTarget,
} from './home-route';
import type { HomePreviewRouteParams } from './home-route-schema';
import { HomeView } from './home-view';

type HomeDetailParams = Partial<HomePreviewRouteParams> & {
  channelId?: string;
  documentType?: string;
  documentId?: string;
  reminderId?: string;
  period?: CalendarPeriodView;
};

function HomeLegacyRouteView() {
  const params = useParams<HomeDetailParams>();
  const [channelSearch] = createSearchParams(channelsSearch);
  const [documentSearch] = createSearchParams(driveSearch);
  const [eventSearch] = createSearchParams(calendarSearch);
  const legacyTarget = () => {
    const { period } = params;
    if (period) return homeCalendarLegacyTarget(period, eventSearch);
    const detail = homeDetailParamsFromRoute(params);
    if (!detail) return;
    return homePreviewLegacyTarget(detail, {
      channel: channelSearch,
      document: documentSearch,
    });
  };

  return (
    <Show when={legacyTarget()}>
      {(target) => <RedirectSplit to={target()} />}
    </Show>
  );
}

export const HomeRouteView = withAuth(() => {
  const params = useParams<HomeDetailParams>();
  const detailRequested = () =>
    homeDetailParamsFromRoute(params) !== undefined ||
    typeof params.reminderId === 'string' ||
    typeof params.period === 'string';

  return (
    <AppView
      id="home"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<HomeLegacyRouteView />}
    >
      <HomeView />
    </AppView>
  );
});
