import { queryClient } from '@queries/client';
import { calendarKeys } from './keys';
import { invalidateCalendarOccurrences } from './occurrences';

/**
 * Refetches everything the calendar UI reads: every mounted occurrence
 * viewport and the calendar list, which also carries per-calendar colors and
 * names.
 */
export function invalidateCalendarViews(): void {
  invalidateCalendarOccurrences();
  queryClient.invalidateQueries({
    queryKey: calendarKeys.visibleCalendars.queryKey,
  });
}

/**
 * Handles `refresh_calendar` websocket events: a sync run committed
 * provider-side changes for one of the viewer's (owned or delegated)
 * inboxes, so mounted calendar viewports refetch. The calendar list is
 * invalidated too, since the same sync discovers new calendars and
 * renames/recolors existing ones.
 *
 * Macro-originated mutations don't need this signal in the acting tab —
 * they persist the provider echo synchronously — but their sync echo
 * flows through here, which is what keeps other tabs and devices fresh.
 */
export function handleRefreshCalendar(payload: unknown): void {
  const event =
    typeof payload === 'object' && payload !== null
      ? (payload as { event?: unknown; link_id?: unknown })
      : undefined;
  if (event?.event !== 'synced' || typeof event.link_id !== 'string') return;

  invalidateCalendarViews();
}
