import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { EventRsvpChoice } from '@app/features/calendar/components/event-rsvp/EventRsvpChoice';
import { EventRsvpError } from '@app/features/calendar/components/event-rsvp/EventRsvpError';
import { EventRsvpRow } from '@app/features/calendar/components/event-rsvp/EventRsvpRow';
import { EventRsvpScope } from '@app/features/calendar/components/event-rsvp/EventRsvpScope';
import { EventRsvpStatus } from '@app/features/calendar/components/event-rsvp/EventRsvpStatus';
import { EventRsvpRoot } from '@app/features/calendar/context/event-rsvp-context';
import type { CalendarEvent } from '@app/features/calendar/types';
import { formatEventSchedule } from '@app/features/calendar/utils/event-schedule';
import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { createEffect, on, onCleanup } from 'solid-js';

export function NeedsReplyRow(props: { event: CalendarEvent }) {
  const calendar = useCalendarView();
  let element: HTMLLIElement | undefined;
  createEffect(
    on(
      () => props.event,
      (event) => {
        const anchor = calendar.selectedEventAnchor();
        if (anchor && element?.contains(anchor))
          calendar.refreshSelectedEvent(event);
      }
    )
  );
  onCleanup(() => {
    const anchor = calendar.selectedEventAnchor();
    if (anchor && element?.contains(anchor)) calendar.closeEventDetails();
  });

  return (
    <EventRsvpRoot event={props.event}>
      <li ref={element} class="min-w-0 rounded-lg py-0.5">
        <div class="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            appearance="bare"
            size="sm"
            class="min-w-0 flex-1 justify-start px-1 text-left"
            onClick={(event) =>
              calendar.selectEvent(props.event, event.currentTarget, 'agenda')
            }
          >
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-sm font-medium">
                {props.event.title || t('calendar.agendaUntitled')}
              </span>
              <span class="truncate text-xs font-normal text-ink-muted">
                {formatEventSchedule(
                  props.event,
                  calendar.displaySettings.timeFormat
                )}
              </span>
            </span>
          </Button>
          <EventRsvpRow class="shrink-0 gap-x-1">
            <EventRsvpStatus />
            <EventRsvpChoice response="accepted" size="xs">
              {t('calendar.replyYes')}
            </EventRsvpChoice>
            <EventRsvpChoice response="declined" size="xs">
              {t('calendar.replyNo')}
            </EventRsvpChoice>
          </EventRsvpRow>
        </div>
        <EventRsvpError />
        <EventRsvpScope />
      </li>
    </EventRsvpRoot>
  );
}
