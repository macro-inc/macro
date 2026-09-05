import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import type { PreviewItem } from '@queries/preview/types';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';

const MENTION_PREVIEW_STALE_TIME = 60_000;

/**
 * Revalidate every cached projection of mentioned calendar events — the
 * shared item-preview entries that message chips render and the calendar
 * block's occurrence-scoped entries — scoped to one event when given.
 * Mounted chips refetch immediately, so a rename or reschedule reaches
 * already-rendered mentions.
 */
export function invalidateCalendarEventPreviews(eventId?: string): void {
  if (eventId) {
    queryClient.invalidateQueries({
      queryKey: previewKeys.item(eventId).queryKey,
    });
  } else {
    queryClient.invalidateQueries({
      queryKey: previewKeys._def,
      // The key carries no type, so it can only be read from cached data.
      // Entries without data need no sweep: null is a cached
      // channel-message-context miss (never a calendar event), and
      // undefined means no fetch has resolved — invalidation cannot outrun
      // it, since an in-flight fetch is joined rather than restarted and a
      // fresh mount refetches regardless.
      predicate: (query) => {
        const data = query.state.data as PreviewItem | null | undefined;
        return data != null && data.type === 'calendar_event';
      },
    });
  }
  queryClient.invalidateQueries({
    queryKey: eventId
      ? [...calendarKeys.mentionPreview._def, eventId]
      : calendarKeys.mentionPreview._def,
  });
}

async function fetchPreview(
  eventId: string,
  occurrenceKey?: string
): Promise<CalendarMentionEvent | null> {
  const result = await storageServiceClient.getBatchCalendarEventPreviews({
    items: [{ eventId, occurrenceKey }],
  });
  if (result.isErr()) {
    throw new Error('Failed to fetch calendar mention preview');
  }
  const item = result.value.items[0];
  return item?.type === 'access' && item.event ? item.event : null;
}

/**
 * Resolve one mentioned event to the viewer's own copy of the meeting,
 * occurrence-scoped when a key is given. Returns `null` when the viewer has
 * no access or the event no longer exists.
 */
export async function fetchCalendarMentionPreview(
  eventId: string,
  occurrenceKey?: string
): Promise<CalendarMentionEvent | null> {
  return queryClient.fetchQuery({
    queryKey: calendarKeys.mentionPreview(eventId, occurrenceKey).queryKey,
    queryFn: () => fetchPreview(eventId, occurrenceKey),
    staleTime: MENTION_PREVIEW_STALE_TIME,
  });
}

/** Target of a reactive mention-preview lookup. */
export interface CalendarMentionPreviewInput {
  eventId: string;
  occurrenceKey?: string;
}

/**
 * Reactive form of {@link fetchCalendarMentionPreview}: the viewer's copy of
 * one event, refetched as the target changes. Shares the cache and stale
 * window with the imperative fetch through the same query key.
 */
export function useCalendarMentionPreviewQuery(
  input: Accessor<CalendarMentionPreviewInput | undefined>,
  options?: Accessor<{ enabled?: boolean }>
) {
  return useQuery(() => {
    const target = input();
    return {
      queryKey: calendarKeys.mentionPreview(
        target?.eventId ?? '',
        target?.occurrenceKey
      ).queryKey,
      queryFn: () => {
        if (!target) {
          throw new Error('Calendar mention preview target is unavailable');
        }
        return fetchPreview(target.eventId, target.occurrenceKey);
      },
      enabled: target !== undefined && options?.().enabled !== false,
      staleTime: MENTION_PREVIEW_STALE_TIME,
    };
  });
}
