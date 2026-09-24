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
import {
  inboxCalendarLegacyTarget,
  inboxDetailParamsFromRoute,
  inboxPreviewLegacyTarget,
} from './inbox-route';
import {
  INBOX_PREVIEW_SEARCH_NAMESPACES,
  type InboxPreviewRouteParams,
  inboxBaseBlockType,
  inboxPreviewRouteParams,
} from './inbox-route-schema';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const InboxView = lazy(async () => ({
  default: (await import('./inbox-view')).InboxView,
}));
const InboxDetailRouteView = lazy(async () => ({
  default: (await import('./inbox-view')).InboxDetailRouteView,
}));
const InboxEntityDetailRouteView = lazy(async () => ({
  default: (await import('./components/InboxEntityDetailRouteView'))
    .InboxEntityDetailRouteView,
}));
const InboxCalendarRouteView = lazy(async () => ({
  default: (await import('./inbox-view')).InboxCalendarRouteView,
}));

type InboxDetailParams = Partial<InboxPreviewRouteParams> & {
  channelId?: string;
  documentType?: string;
  documentId?: string;
  period?: CalendarPeriodView;
};

function LegacyInboxView() {
  const preset = getViewPreset('inbox');
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

function InboxLegacyRouteView() {
  const params = useParams<InboxDetailParams>();
  const [channelSearch] = createSearchParams(channelsSearch);
  const [documentSearch] = createSearchParams(driveSearch);
  const [eventSearch] = createSearchParams(calendarSearch);
  const legacyTarget = () => {
    const { period } = params;
    if (period) return inboxCalendarLegacyTarget(period, eventSearch);
    const detail = inboxDetailParamsFromRoute(params);
    if (!detail) return;
    return inboxPreviewLegacyTarget(detail, {
      channel: channelSearch,
      document: documentSearch,
    });
  };

  return (
    <Show when={legacyTarget()} fallback={<LegacyInboxView />}>
      {(target) => <RedirectSplit to={target()} />}
    </Show>
  );
}

export const InboxRouteView = withAuth(() => {
  const params = useParams<InboxDetailParams>();
  const detailRequested = () =>
    inboxDetailParamsFromRoute(params) !== undefined ||
    typeof params.period === 'string';

  return (
    <NewAppView
      id="inbox"
      composableOnTouch
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<InboxLegacyRouteView />}
      fallback={<LegacyInboxView />}
    >
      <InboxView />
    </NewAppView>
  );
});

/** The Calendar view inline in Home, at the Calendar route's own period path and search. */
export const inboxCalendarRoute = defineRoute({
  id: 'inbox-calendar',
  path: 'calendar/:period',
  params: calendarPeriodParams,
  serializeParams: ({ period }) => ({ period: calendarPeriodPath(period) }),
  component: InboxCalendarRouteView,
  search: [CALENDAR_SEARCH_NAMESPACE],
});

export const inboxChannelRoute = defineRoute({
  ...channelDetailRoute,
  id: 'inbox-channel',
  path: 'channel/:channelId',
  component: InboxEntityDetailRouteView,
});

export const inboxDocumentRoute = defineRoute({
  ...driveRootDocumentRoute,
  id: 'inbox-document',
  component: InboxEntityDetailRouteView,
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
    `${inboxBaseBlockType(documentType)}:${documentId}`,
});
export const inboxPreviewRoute = defineRoute({
  id: 'inbox-preview',
  path: ':blockType/:previewId',
  params: inboxPreviewRouteParams,
  component: InboxDetailRouteView,
  search: INBOX_PREVIEW_SEARCH_NAMESPACES,
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
    `${inboxBaseBlockType(blockType)}:${previewId}`,
  claim: ({ blockType, previewId }) => ({
    namespace: 'block',
    id: `${inboxBaseBlockType(blockType)}:${previewId}`,
  }),
});

export const inboxSplitRoute = defineRoute({
  id: 'view-inbox',
  path: 'inbox',
  component: InboxRouteView,
  search: '*' as const,
  // The period path is matched before the block pattern can claim `calendar`.
  children: [
    inboxCalendarRoute,
    inboxChannelRoute,
    inboxDocumentRoute,
    inboxPreviewRoute,
  ],
});
