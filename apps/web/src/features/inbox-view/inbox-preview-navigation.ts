import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import {
  CALENDAR_SEARCH_NAMESPACE,
  calendarSearchCodec,
  calendarTargetSearch,
} from '@app/features/calendar-view/calendar-url';
import type { CalendarViewTarget } from '@app/features/calendar-view/types';
import {
  channelsSearch,
  channelsSearchCodec,
} from '@app/features/channels-view/channels-route';
import {
  driveSearch,
  driveSearchCodec,
} from '@app/features/drive-view/primitives/drive-search';
import type { SerializedSearchParams } from '@app/lib/split-router';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as MD_URL_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_URL_PARAMS } from '@block-pdf/constants';
import {
  type PreviewBlockTarget,
  type PreviewPanelSelection,
  previewBlockTarget,
} from '@components/app/previewTarget';
import type { InboxPreviewRouteParams } from './inbox-route-schema';

type DetailSearch = Record<string, SerializedSearchParams | undefined>;

export type InboxPreviewNavigation = {
  params: InboxPreviewRouteParams;
  search: DetailSearch;
};

export type InboxCalendarNavigation = {
  params: { period: CalendarPeriodView };
  search: DetailSearch;
};

/** Every detail namespace is written so a previous item's location cannot linger. */
export function inboxDetailSearch(
  detail: {
    channel?: SerializedSearchParams;
    document?: SerializedSearchParams;
    calendar?: SerializedSearchParams;
  } = {}
): DetailSearch {
  return {
    [channelsSearch.namespace]: detail.channel,
    [driveSearch.namespace]: detail.document,
    [CALENDAR_SEARCH_NAMESPACE]: detail.calendar,
  };
}

function targetParam(target: PreviewBlockTarget, key: string): string {
  const value = (target.params as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value : '';
}

function documentDetailSearch(
  target: PreviewBlockTarget
): SerializedSearchParams | undefined {
  if (target.blockType === 'channel') return;
  return driveSearchCodec.serialize({
    ...driveSearch.defaults,
    commentId:
      targetParam(target, MD_URL_PARAMS.commentId) ||
      targetParam(target, PDF_URL_PARAMS.annotationId),
  });
}

function channelTargetSearch(
  target: PreviewBlockTarget
): SerializedSearchParams | undefined {
  if (target.blockType !== 'channel') return;
  const params = (target.params ?? {}) as Record<string, unknown>;
  const value = (key: string) => {
    const raw = params[key];
    return typeof raw === 'string' ? raw : '';
  };
  return channelsSearchCodec.serialize({
    ...channelsSearch.defaults,
    messageId: value(CHANNEL_URL_PARAMS.message),
    threadId: value(CHANNEL_URL_PARAMS.thread),
  });
}

/** Route destination for a resolved block target. */
export function inboxPreviewTargetNavigation(
  target: PreviewBlockTarget
): InboxPreviewNavigation {
  return {
    params: {
      blockType: target.aliasContext?.alias ?? target.blockType,
      previewId: target.blockId,
    },
    search: inboxDetailSearch({
      channel: channelTargetSearch(target),
      document: documentDetailSearch(target),
    }),
  };
}

/**
 * Route destination for a calendar event: the Calendar view's own period path
 * with the event and its locator range in the Calendar search namespace.
 */
export function inboxCalendarNavigation(
  target: CalendarViewTarget,
  period: CalendarPeriodView = getPreferredCalendarPeriodView()
): InboxCalendarNavigation | undefined {
  if (!target.eventId) return;
  return {
    params: { period },
    search: inboxDetailSearch({
      calendar: calendarSearchCodec.serialize(calendarTargetSearch(target)),
    }),
  };
}

/** Reduces a live row to the block it opens and the params that locate content in it. */
export function inboxPreviewNavigation(
  selection: PreviewPanelSelection
): InboxPreviewNavigation {
  return inboxPreviewTargetNavigation(previewBlockTarget(selection));
}
