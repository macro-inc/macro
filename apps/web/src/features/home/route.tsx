import type { CalendarPeriodView } from '@app/features/calendar/types';
import {
  CALENDAR_SEARCH_NAMESPACE,
  calendarPeriodParams,
  calendarPeriodPath,
  calendarSearch,
} from '@app/features/calendar-view/calendar-url';
import { channelsSearch } from '@app/features/channels-view/channels-route';
import { channelDetailRoute } from '@app/features/channels-view/route';
import { driveSearch } from '@app/features/drive-view/primitives/drive-search';
import { driveRootDocumentRoute } from '@app/features/drive-view/route';
import {
  createSearchParams,
  defineRoute,
  routeParams,
  type SplitRouterEntry,
  useParams,
} from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as MARKDOWN_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import {
  NewAppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazy, Show } from 'solid-js';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '../email-thread/core/location';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { HomeEntityDetailRouteView } from './components/HomeEntityDetailRouteView';
import {
  homeCalendarLegacyTarget,
  homeDetailParamsFromRoute,
  homePreviewLegacyTarget,
} from './home-route';
import {
  HOME_PREVIEW_SEARCH_NAMESPACES,
  type HomePreviewRouteParams,
  homeBaseBlockType,
  homePreviewRouteParams,
} from './home-route-schema';
import {
  HomeCalendarRouteView,
  HomeDetailRouteView,
  HomeView,
} from './home-view';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));

type HomeDetailParams = Partial<HomePreviewRouteParams> & {
  channelId?: string;
  documentType?: string;
  documentId?: string;
  period?: CalendarPeriodView;
};

function LegacyHomeView() {
  const preset = getViewPreset('home');
  return (
    <SoupView
      viewName={isTouchDevice() ? 'Notifications' : 'Home'}
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      disableLocalSearch
    />
  );
}

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
    <Show when={legacyTarget()} fallback={<LegacyHomeView />}>
      {(target) => <RedirectSplit to={target()} />}
    </Show>
  );
}

export const HomeRouteView = withAuth(() => {
  const params = useParams<HomeDetailParams>();
  const detailRequested = () =>
    homeDetailParamsFromRoute(params) !== undefined ||
    typeof params.period === 'string';

  return (
    <NewAppView
      id="home"
      composableOnTouch
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<HomeLegacyRouteView />}
      fallback={<LegacyHomeView />}
    >
      <HomeView />
    </NewAppView>
  );
});

/** The Calendar view inline in Home, at the Calendar route's own period path and search. */
export const homeCalendarRoute = defineRoute({
  id: 'home-calendar',
  path: 'calendar/:period',
  params: calendarPeriodParams,
  serializeParams: ({ period }) => ({ period: calendarPeriodPath(period) }),
  component: HomeCalendarRouteView,
  search: [CALENDAR_SEARCH_NAMESPACE],
});

export const homeChannelRoute = defineRoute({
  ...channelDetailRoute,
  id: 'home-channel',
  path: 'channel/:channelId',
  component: HomeEntityDetailRouteView,
});

export const homeDocumentRoute = defineRoute({
  ...driveRootDocumentRoute,
  id: 'home-document',
  component: HomeEntityDetailRouteView,
  externalSearch: (entry: Readonly<SplitRouterEntry>) => {
    const type = routeParams<{ documentType?: string }>(
      entry.location.route
    ).documentType;
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    if (type === 'pdf') return Object.values(PDF_URL_PARAMS);
    return type === 'spreadsheet' ? [MARKDOWN_URL_PARAMS.commentId] : [];
  },
  remountKey: ({ documentType, documentId }) =>
    `${homeBaseBlockType(documentType)}:${documentId}`,
});
export const homePreviewRoute = defineRoute({
  id: 'home-preview',
  path: ':blockType/:previewId',
  params: homePreviewRouteParams,
  component: HomeDetailRouteView,
  search: HOME_PREVIEW_SEARCH_NAMESPACES,
  // Blocks read their own location keys from the URL, as they do in Drive.
  externalSearch: (entry: Readonly<SplitRouterEntry>) => {
    const type = routeParams<{ blockType?: string }>(
      entry.location.route
    ).blockType;
    if (type === 'channel') return Object.values(CHANNEL_URL_PARAMS);
    if (type === 'email') return Object.values(EMAIL_URL_PARAMS);
    if (
      type === 'md' ||
      type === 'task' ||
      type === 'snippet' ||
      type === 'skill'
    ) {
      return Object.values(MARKDOWN_URL_PARAMS);
    }
    if (type === 'pdf') return Object.values(PDF_URL_PARAMS);
    return type === 'spreadsheet' ? [MARKDOWN_URL_PARAMS.commentId] : [];
  },
  remountKey: ({ blockType, previewId }) =>
    `${homeBaseBlockType(blockType)}:${previewId}`,
  claim: ({ blockType, previewId }) => ({
    namespace: 'block',
    id: `${homeBaseBlockType(blockType)}:${previewId}`,
  }),
});

export const homeSplitRoute = defineRoute({
  id: 'view-home',
  path: 'home',
  component: HomeRouteView,
  search: '*' as const,
  // The period path is matched before the block pattern can claim `calendar`.
  children: [
    homeCalendarRoute,
    homeChannelRoute,
    homeDocumentRoute,
    homePreviewRoute,
  ],
});
