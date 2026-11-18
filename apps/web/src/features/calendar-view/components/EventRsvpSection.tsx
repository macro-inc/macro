import { EventRsvpChoice } from '@app/features/calendar/components/event-rsvp/EventRsvpChoice';
import { EventRsvpError } from '@app/features/calendar/components/event-rsvp/EventRsvpError';
import { EventRsvpRow } from '@app/features/calendar/components/event-rsvp/EventRsvpRow';
import { EventRsvpScope } from '@app/features/calendar/components/event-rsvp/EventRsvpScope';
import { EventRsvpStatus } from '@app/features/calendar/components/event-rsvp/EventRsvpStatus';
import { EventRsvpRoot } from '@app/features/calendar/context/event-rsvp-context';
import type { CalendarEvent } from '@app/features/calendar/types';

/**
 * RSVP controls for the connected account's own attendance.
 * Recurring responses retain the existing occurrence-or-series scope dialog.
 */
export function EventRsvpSection(props: {
  event: CalendarEvent;
  buttonSize?: 'sm' | 'md';
  agenda?: boolean;
}) {
  return (
    <EventRsvpRoot event={props.event}>
      <EventRsvpRow
        class={
          props.agenda
            ? 'border-edge-muted border-t bg-surface px-4 py-2.5 text-sm text-ink sm:text-xs mobile:border-0 mobile:px-6 mobile:pt-4 mobile:pb-2'
            : 'border-edge-muted border-t bg-active px-4 py-2.5 text-sm text-ink-muted sm:text-xs mobile:border-0 mobile:bg-transparent mobile:px-6 mobile:pt-4 mobile:pb-2'
        }
      >
        <span class="flex shrink-0 items-center gap-2">
          Going?
          <EventRsvpStatus />
        </span>
        <div class="ml-auto flex shrink-0 gap-3 lg:gap-2">
          <EventRsvpChoice response="accepted" size={props.buttonSize}>
            Yes
          </EventRsvpChoice>
          <EventRsvpChoice response="tentative" size={props.buttonSize}>
            Maybe
          </EventRsvpChoice>
          <EventRsvpChoice response="declined" size={props.buttonSize}>
            No
          </EventRsvpChoice>
        </div>
        <EventRsvpError />
      </EventRsvpRow>
      <EventRsvpScope />
    </EventRsvpRoot>
  );
}
