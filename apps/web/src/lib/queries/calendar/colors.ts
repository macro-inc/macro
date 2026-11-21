import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import { emailClient } from '@service-email/client';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { answeringGraphqlCalendarHost } from './graphql/flag';
import { executeGraphqlSetCalendarColor } from './graphql/mutations';
import { CALENDAR_COLOR_MUTATION_KEY, calendarKeys } from './keys';
import { isLastPendingSave } from './setting-saves';

export interface CalendarColorChange {
  userId: string;
  calendarId: string;
  /** Lowercase `#rrggbb`, or `null` to show the provider's color again. */
  color: string | null;
}

/**
 * Whether a save patched the list itself (REST), and the calendar's own
 * color before it, restored if the save fails.
 */
interface CalendarColorSnapshot {
  patched: boolean;
  previous: string | null | undefined;
}

const visibleCalendarsOf = (userId: string) => ({
  queryKey: calendarKeys.visibleCalendars(userId).queryKey,
});

function withCustomColor(
  calendars: VisibleCalendar[] | undefined,
  calendarId: string,
  color: string | null | undefined
) {
  return calendars?.map((calendar) =>
    calendar.id === calendarId ? { ...calendar, customColor: color } : calendar
  );
}

export async function saveCalendarColor(
  change: CalendarColorChange
): Promise<void> {
  await Telemetry.span('calendar.set_color', async (span) => {
    const host = answeringGraphqlCalendarHost();
    span.setAttr('calendar.calendar_id', change.calendarId);
    span.setAttr('calendar.color.cleared', change.color === null);
    span.setAttr('calendar.transport', host ? 'graphql' : 'rest');
    try {
      if (host) {
        const outcome = await executeGraphqlSetCalendarColor(change);
        span.setAttr('calendar.color.outcome', outcome.kind);
        return;
      }
      await throwOnErr(() =>
        emailClient.setCalendarColor(change.calendarId, {
          color: change.color,
        })
      );
      span.setAttr('calendar.color.outcome', 'committed');
    } catch (error) {
      span.setAttr('calendar.color.outcome', 'failed');
      span.error('Calendar color save failed');
      throw error;
    }
  });
}

const calendarColorMutationOptions = {
  mutationKey: CALENDAR_COLOR_MUTATION_KEY,
  scope: { id: 'calendar-color' },
  mutationFn: saveCalendarColor,
  // A GraphQL save shows on the calendar's cached record, which the list
  // reads; only a REST save patches the list itself.
  onMutate: async (
    change: CalendarColorChange
  ): Promise<CalendarColorSnapshot> => {
    if (answeringGraphqlCalendarHost()) {
      return { patched: false, previous: undefined };
    }
    const lists = visibleCalendarsOf(change.userId);
    await queryClient.cancelQueries(lists);
    const previous = queryClient
      .getQueriesData<VisibleCalendar[]>(lists)
      .flatMap(([, calendars]) => calendars ?? [])
      .find((calendar) => calendar.id === change.calendarId)?.customColor;
    queryClient.setQueriesData<VisibleCalendar[]>(lists, (calendars) =>
      withCustomColor(calendars, change.calendarId, change.color)
    );
    return { patched: true, previous };
  },
  onError: (
    _error: unknown,
    change: CalendarColorChange,
    snapshot: CalendarColorSnapshot | undefined
  ) => {
    if (!snapshot?.patched || !isLastPendingSave(CALENDAR_COLOR_MUTATION_KEY))
      return;
    queryClient.setQueriesData<VisibleCalendar[]>(
      visibleCalendarsOf(change.userId),
      (calendars) =>
        withCustomColor(calendars, change.calendarId, snapshot.previous)
    );
  },
  onSettled: (
    _data: unknown,
    _error: unknown,
    change: CalendarColorChange,
    snapshot: CalendarColorSnapshot | undefined
  ) =>
    snapshot?.patched && isLastPendingSave(CALENDAR_COLOR_MUTATION_KEY)
      ? queryClient.invalidateQueries(visibleCalendarsOf(change.userId))
      : undefined,
};

/**
 * Sets the viewer's own color for a calendar, or clears it to show the
 * provider's color again. Macro keeps it for the account, so it follows the
 * person to every device; the provider never sees it.
 */
export function useSetCalendarColorMutation() {
  return useMutation(() => calendarColorMutationOptions);
}
