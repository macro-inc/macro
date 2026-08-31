import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { calendarKeys } from './keys';

const MENTION_PREVIEW_STALE_TIME = 60_000;

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
