import type { CalendarBlockProps } from '@block-calendar/types';
import { URL_PARAMS as CHANNEL_URL_PARAMS } from '@block-channel/constants';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from '@components/app/previewTarget';
import {
  type InboxPreviewRouteParams,
  type InboxPreviewSearchParams,
  inboxPreviewSearch,
} from './inbox-route';

function calendarSearch(
  params: CalendarBlockProps | undefined
): Partial<InboxPreviewSearchParams> {
  const range = params?.range;
  return {
    eventId: params?.eventId ?? '',
    occurrenceKey: params?.occurrenceKey ?? '',
    ...(range
      ? {
          calendarTimeKind: 'timed',
          startsAt: range.start,
          endsAt: range.end,
          startDate: range.startDate,
          endDate: range.endDate,
        }
      : {}),
  };
}

function selectionSearch(
  selection: PreviewPanelSelection,
  blockParams: Record<string, unknown> | undefined
): InboxPreviewSearchParams {
  const channelParam = (key: string) => {
    const value = blockParams?.[key];
    return typeof value === 'string' ? value : '';
  };
  const base: InboxPreviewSearchParams = {
    ...inboxPreviewSearch.defaults,
    selectionType: selection.type,
    selectionId: selection.id,
  };

  switch (selection.type) {
    case 'document':
      return {
        ...base,
        fileType: selection.fileType ?? '',
        subType: selection.subType?.type ?? '',
      };
    case 'foreign':
      return { ...base, foreignSource: selection.foreignSource };
    case 'channel':
      return {
        ...base,
        targetMessageId: channelParam(CHANNEL_URL_PARAMS.message),
        targetThreadId: channelParam(CHANNEL_URL_PARAMS.thread),
      };
    case 'channel_message':
    case 'channel_thread':
      return {
        ...base,
        sourceMessageId: selection.messageId,
        sourceThreadId: selection.threadId ?? '',
        targetMessageId: channelParam(CHANNEL_URL_PARAMS.message),
        targetThreadId: channelParam(CHANNEL_URL_PARAMS.thread),
      };
    case 'calendar_event':
      return {
        ...base,
        ...calendarSearch(blockParams as CalendarBlockProps | undefined),
      };
    case 'reminder':
      return {
        ...base,
        reminderId: selection.id,
        referencedType: selection.referencedEntity?.type ?? '',
        referencedFileType: selection.referencedEntity?.fileType ?? '',
        referencedSubType: selection.referencedEntity?.subType ?? '',
      };
    default:
      return base;
  }
}

/** Converts a live row into a minimal, reloadable Inbox route destination. */
export function inboxPreviewNavigation(selection: PreviewPanelSelection) {
  const target = previewBlockTarget(selection);
  const search = selectionSearch(
    selection,
    target.params as Record<string, unknown> | undefined
  );

  return {
    params: {
      blockType: target.blockType,
      previewId: target.blockId,
    } satisfies InboxPreviewRouteParams,
    search,
  };
}
