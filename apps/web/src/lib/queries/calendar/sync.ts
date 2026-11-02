import { fireAndForget } from '@core/util/fireAndForget';
import { queryClient } from '@queries/client';
import { invalidateCalendarInvitations } from './invitations';
import { calendarKeys, RSVP_MUTATION_KEY } from './keys';
import { invalidateCalendarEventPreviews } from './mention-preview';
import { invalidateCalendarOccurrences } from './occurrences';
import { refreshTeamCalendarQueries } from './team-cache';

/**
 * Refetches everything the calendar UI reads: every mounted occurrence
 * viewport, the calendar list (which also carries per-calendar colors and
 * names), teammates' out-of-office overlays, the cached previews behind
 * calendar mention chips, and open event details' requests to join.
 */
export function invalidateCalendarViews(): void {
  fireAndForget(refreshTeamCalendarQueries(), 'calendar-sync');
  fireAndForget(invalidateCalendarInvitations(), 'calendar-sync');
  fireAndForget(invalidateCalendarOccurrences(), 'calendar-sync');
  invalidateCalendarEventPreviews();
  queryClient.invalidateQueries({
    queryKey: calendarKeys.visibleCalendars.queryKey,
  });
  queryClient.invalidateQueries({
    queryKey: calendarKeys.joinRequests._def,
  });
}

/**
 * Handles `refresh_calendar` websocket events: a provider sync run — or a
 * Macro-originated mutation, which nudges every viewer of the link
 * including the acting tab — committed changes for one of the viewer's
 * (owned or delegated) inboxes, so mounted calendar viewports refetch. The
 * calendar list is invalidated too, since a sync discovers new calendars
 * and renames/recolors existing ones, and so are requests to join, since
 * those viewers read and answer them. `join_request_answered` goes to the
 * requester, who views the event through a channel share, so only the
 * event's previews refetch: they carry the request's status.
 */
export function handleRefreshCalendar(payload: unknown): void {
  const event =
    typeof payload === 'object' && payload !== null
      ? (payload as {
          event?: unknown;
          event_id?: unknown;
          link_id?: unknown;
          team_ooo_changed?: unknown;
        })
      : undefined;
  if (event?.event === 'join_request_answered') {
    if (typeof event.event_id === 'string') {
      invalidateCalendarEventPreviews(event.event_id);
    }
    return;
  }
  if (event?.event === 'team_sharing_changed') {
    fireAndForget(
      refreshTeamCalendarQueries({
        outOfOfficeChanged: event.team_ooo_changed !== false,
      }),
      'calendar-sync'
    );
    return;
  }
  if (event?.event !== 'synced' || typeof event.link_id !== 'string') return;
  // Old servers and unknown hints retain immediate revocation behavior.
  fireAndForget(
    refreshTeamCalendarQueries({
      outOfOfficeChanged: event.team_ooo_changed !== false,
    }),
    'calendar-sync'
  );

  // An in-flight RSVP holds optimistic occurrence state a refetch would
  // clobber; the last RSVP to settle re-invalidates occurrences itself, so
  // only the caches without optimistic writes refresh meanwhile.
  if (queryClient.isMutating({ mutationKey: RSVP_MUTATION_KEY }) === 0) {
    fireAndForget(invalidateCalendarInvitations(), 'calendar-sync');
    fireAndForget(invalidateCalendarOccurrences(), 'calendar-sync');
  }
  invalidateCalendarEventPreviews();
  queryClient.invalidateQueries({
    queryKey: calendarKeys.visibleCalendars.queryKey,
  });
  queryClient.invalidateQueries({
    queryKey: calendarKeys.joinRequests._def,
  });
}
