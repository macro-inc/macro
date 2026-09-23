import { getChannelEntityTarget } from '@app/features/next-soup/utils';
import type { CalendarBlockProps } from '@block-calendar/types';
import {
  type PreviewPanelSelection,
  previewBlockTarget,
} from '@components/app/previewTarget';
import {
  type InboxPreviewSearchParams,
  inboxPreviewSearch,
} from './inbox-route';
import type { InboxPreviewRouteParams } from './inbox-route-schema';

function calendarSearch(
  params: CalendarBlockProps | undefined,
  time: Extract<PreviewPanelSelection, { type: 'calendar_event' }>['time']
): Partial<InboxPreviewSearchParams> {
  const range = params?.range;
  return {
    eventId: params?.eventId ?? '',
    occurrenceKey: params?.occurrenceKey ?? '',
    ...(time?.kind === 'allDay'
      ? {
          calendarTimeKind: 'allDay',
          startDate: time.startDate,
          endDate: time.endDate ?? range?.endDate ?? '',
        }
      : time?.kind === 'timed'
        ? {
            calendarTimeKind: 'timed',
            startsAt: time.startsAt,
            endsAt: time.endsAt ?? range?.end ?? '',
          }
        : range
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
  const channelTarget =
    selection.type === 'channel' ||
    selection.type === 'channel_message' ||
    selection.type === 'channel_thread'
      ? getChannelEntityTarget(selection)
      : undefined;
  const channelSearch = {
    targetMessageId:
      channelTarget?.kind === 'message' ? channelTarget.messageId : '',
    targetThreadId:
      channelTarget?.kind === 'message' ? (channelTarget.threadId ?? '') : '',
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
        ...channelSearch,
      };
    case 'channel_message':
    case 'channel_thread':
      return {
        ...base,
        sourceMessageId: selection.messageId,
        sourceThreadId: selection.threadId ?? '',
        ...channelSearch,
      };
    case 'calendar_event':
      return {
        ...base,
        ...calendarSearch(
          blockParams as CalendarBlockProps | undefined,
          selection.time
        ),
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
