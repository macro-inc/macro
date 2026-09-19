import { queryClient } from '@queries/client';
import { calendarKeys, RSVP_MUTATION_KEY } from './keys';
import { invalidateCalendarEventPreviews } from './mention-preview';
import { invalidateCalendarOccurrences } from './occurrences';
import { invalidateTeamOutOfOffice } from './team-ooo';

/**
 * Refetches everything the calendar UI reads: every mounted occurrence
 * viewport, the calendar list (which also carries per-calendar colors and
 * names), teammates' out-of-office overlays, and the cached previews behind
 * calendar mention chips.
 */
export function invalidateCalendarViews(): void {
  invalidateCalendarOccurrences();
  invalidateCalendarEventPreviews();
  invalidateTeamOutOfOffice();
  queryClient.invalidateQueries({
    queryKey: calendarKeys.visibleCalendars.queryKey,
  });
}

/**
 * Handles `refresh_calendar` websocket events: a provider sync run — or a
 * Macro-originated mutation, which nudges every viewer of the link
 * including the acting tab — committed changes for one of the viewer's
 * (owned or delegated) inboxes, so mounted calendar viewports refetch. The
 * calendar list is invalidated too, since a sync discovers new calendars
 * and renames/recolors existing ones.
 */
export function handleRefreshCalendar(payload: unknown): void {
  const event =
    typeof payload === 'object' && payload !== null
      ? (payload as { event?: unknown; link_id?: unknown })
      : undefined;
  if (event?.event !== 'synced' || typeof event.link_id !== 'string') return;

  // An in-flight RSVP holds optimistic occurrence state a refetch would
  // clobber; the last RSVP to settle re-invalidates occurrences itself, so
  // only the caches without optimistic writes refresh meanwhile.
  if (queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) === 0) {
    invalidateCalendarOccurrences();
  }
  invalidateCalendarEventPreviews();
  invalidateTeamOutOfOffice();
  queryClient.invalidateQueries({
    queryKey: calendarKeys.visibleCalendars.queryKey,
  });
}
