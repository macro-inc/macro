import { CalendarEmbed } from '@app/features/calendar/components/CalendarEmbed';
import {
  type CalendarEvent,
  DEFAULT_CALENDAR_SOURCE,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
} from '@app/features/calendar/types';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, Dialog } from '@ui';
import { addMinutes, format, parseISO } from 'date-fns';
import { createSignal, Show } from 'solid-js';
import { HOME_CALENDAR, type HomeCalendarEvent } from '../core/calendar-events';

/** Today's sample events in the shared calendar embed; no calendar requests. */
export function HomeCalendar() {
  const today = new Date();
  const date = format(today, 'yyyy-MM-dd');
  const [event, setEvent] = createSignal<HomeCalendarEvent>();
  const events: CalendarEvent[] = HOME_CALENDAR.events
    .filter((item) => item.date === HOME_CALENDAR.date)
    .map((item) => {
      const start = parseISO(`${date}T${item.startsAt}`);
      return {
        id: item.id,
        eventId: item.id,
        occurrenceKey: item.id,
        isCancelled: false,
        isReadOnly: true,
        attendees: [],
        guestPolicy: DEFAULT_GUEST_POLICY,
        viewerCan: NO_VIEWER_CAPABILITIES,
        sourceCalendarIds: [DEFAULT_CALENDAR_SOURCE.id],
        recurrenceLines: [],
        title: item.title,
        start: start.toISOString(),
        end: addMinutes(start, item.durationMinutes).toISOString(),
        allDay: false,
        calendar: DEFAULT_CALENDAR_SOURCE,
        visibleCalendars: [DEFAULT_CALENDAR_SOURCE],
        location: item.location,
      };
    });
  const eventsById = new Map(events.map((item) => [item.id, item]));

  return (
    <section
      class="mt-8 flex h-[360px] min-w-0 flex-col"
      aria-label="Today's calendar"
      data-home-calendar
      onFocusIn={(event) => {
        // Keep the Home priority shortcuts out of the calendar controls.
        if (event.target instanceof HTMLElement)
          event.target.setAttribute('data-keyboard-input', '');
      }}
    >
      <div class="flex h-9 shrink-0 items-center px-1">
        <h2 class="flex items-center gap-2 text-sm font-medium">
          Today
          <span class="text-xs font-normal text-ink-extra-muted">
            {format(today, 'EEE, MMM d')}
          </span>
        </h2>
      </div>
      <div class="min-h-0 flex-1">
        <CalendarEmbed
          initialDate={today}
          events={events}
          eventsById={eventsById}
          settings={{
            initialView: 'timeGridDay',
            timeGridLayout: 'overview',
            openingScrollTime: '00:00:00',
            showDayHeaders: false,
            collapseEmptyAllDaySlot: true,
            showWeekends: true,
            weekStartsOn: 1,
            timeFormat: '12-hour',
          }}
          selection={{
            color: 'var(--color-calendar)',
            onEventSelect: (selected) =>
              setEvent(
                HOME_CALENDAR.events.find((item) => item.id === selected.id)
              ),
          }}
        />
      </div>
      <Show when={event()} keyed>
        {(item) => (
          <Dialog
            open
            position="center"
            onOpenChange={(open) => {
              if (!open) setEvent(undefined);
            }}
          >
            <div class="p-6">
              <div class="flex items-start justify-between gap-4">
                <Dialog.Title class="text-xl font-medium">
                  {item.title}
                </Dialog.Title>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close event"
                  onClick={() => setEvent(undefined)}
                >
                  <CloseIcon class="size-4" />
                </Button>
              </div>
              <Dialog.Description class="mt-3 text-sm text-ink-muted">
                {format(today, 'EEEE, MMMM d')} · {item.time}
              </Dialog.Description>
              <p class="mt-2 text-sm text-ink-muted">{item.location}</p>
              <p class="mt-6 text-sm leading-relaxed">{item.description}</p>
              <p class="mt-6 text-xs text-ink-extra-muted">
                Sample event · No calendar changes are made
              </p>
            </div>
          </Dialog>
        )}
      </Show>
    </section>
  );
}
