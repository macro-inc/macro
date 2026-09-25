import { useUserId } from '@core/context/user';
import { useUpdateCalendarEventMutation } from '@queries/calendar/mutations';
import {
  createCalendarOccurrenceQueryRange,
  useCalendarOccurrencesQuery,
} from '@queries/calendar/occurrences';
import { createMemo, Show } from 'solid-js';
import { useCalendarView } from '../calendar/components/CalendarViewContext';
import {
  isCalendarEventVisible,
  mapCalendarOccurrence,
} from '../calendar/types';
import { safeConferenceUrl } from '../calendar/utils/conference-link';
import { viewerCanEditGuests } from '../calendar/utils/event-guest-editing';
import { calendarMacroCallUrl } from '../calendar/utils/macro-call-link';
import { CalendarCallsView } from '../meetings/calendar-calls-view';
import type { CalendarCallEvent } from '../meetings/core/calendar-calls';
import { useOpenEventComposer } from './components/use-open-event-composer';
import { openCalendarEventSplit } from './open-calendar-event';

/** Calendar-side composition: invited calls join owned links in the Calls view. */
export function CalendarCalls(props: {
  onScheduleCall: () => void;
  onShowEvents: () => void;
}) {
  const calendarView = useCalendarView();
  const userId = useUserId();
  const openComposer = useOpenEventComposer();
  const updateEvent = useUpdateCalendarEventMutation();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 90);
  start.setDate(start.getDate() - 30);
  const range = createCalendarOccurrenceQueryRange(start, end);
  const query = useCalendarOccurrencesQuery(() => ({
    userId: userId(),
    range,
  }));
  const events = createMemo(() =>
    query.isSuccess
      ? query.data.items.map((item) =>
          mapCalendarOccurrence(item, { sourceById: calendarView.sourceById() })
        )
      : []
  );
  const callEvents = createMemo<CalendarCallEvent[]>(() =>
    events().flatMap((event) => {
      if (
        event.isCancelled ||
        !isCalendarEventVisible(event, calendarView.isSourceVisible)
      )
        return [];
      const macroUrl = calendarMacroCallUrl(event);
      const url = macroUrl ?? safeConferenceUrl(event.conferenceUrl);
      return url
        ? [
            {
              eventId: event.eventId,
              occurrenceKey: event.occurrenceKey,
              title: event.title,
              start: event.start,
              end: event.end,
              timeZone: event.timeZone,
              allDay: event.allDay,
              account: event.calendar.emailAddress ?? event.calendar.name,
              url,
              external: !macroUrl,
              canEdit: !event.isReadOnly,
              canInvite: viewerCanEditGuests(event),
              recurring: Boolean(
                event.recurrenceId || event.recurrenceLines.length
              ),
              attendees: event.attendees.map((person) => ({
                name: person.displayName ?? undefined,
                email: person.email,
                status: person.responseStatus,
                organizer: person.isOrganizer,
              })),
            },
          ]
        : [];
    })
  );

  const findEvent = (eventId: string, occurrenceKey?: string) =>
    events().find(
      (event) =>
        event.eventId === eventId &&
        (!occurrenceKey || event.occurrenceKey === occurrenceKey)
    );
  return (
    <div class="flex size-full min-h-0 flex-col">
      <Show when={query.isError}>
        <div
          class="flex items-center gap-3 border-b border-edge-muted px-4 py-2 text-xs text-ink-muted"
          role="status"
        >
          Calendar invitations could not be loaded.
          <button
            type="button"
            class="underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      </Show>
      <CalendarCallsView
        events={callEvents()}
        onScheduleCall={props.onScheduleCall}
        onInviteToEvent={async (call, email) => {
          const event = findEvent(call.eventId, call.occurrenceKey);
          if (!event || !viewerCanEditGuests(event))
            throw new Error('Event is not editable');
          if (
            event.attendees.some(
              (person) => person.email.toLowerCase() === email
            )
          )
            return;
          await updateEvent.mutateAsync({
            eventId: event.eventId,
            calendarId: event.calendarId,
            scope: event.recurrenceId ? 'this_event' : undefined,
            recurrenceId: event.recurrenceId,
            occurrenceKey: event.occurrenceKey,
            patch: {
              attendees: [
                ...event.attendees.map((person) => ({ email: person.email })),
                { email },
              ],
            },
          });
        }}
        onOpenEvent={(eventId, occurrenceKey) => {
          props.onShowEvents();
          void openCalendarEventSplit({ eventId, occurrenceKey });
        }}
        onEditEvent={(eventId, occurrenceKey) => {
          const event = findEvent(eventId, occurrenceKey);
          if (event) openComposer({ event });
        }}
      />
    </div>
  );
}
