import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { calendarKeys } from './keys';

const MENTION_PREVIEW_STALE_TIME = 60_000;

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
    queryFn: async () => {
      const result = await storageServiceClient.getBatchCalendarEventPreviews({
        items: [{ eventId, occurrenceKey }],
      });
      if (result.isErr()) {
        throw new Error('Failed to fetch calendar mention preview');
      }
      const item = result.value.items[0];
      return item?.type === 'access' && item.event ? item.event : null;
    },
    staleTime: MENTION_PREVIEW_STALE_TIME,
  });
}
