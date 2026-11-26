import { createAssertedContextProvider } from '@core/context/createContext';
import { createMemo, type ParentProps } from 'solid-js';
import { createCalendarRsvpController } from '../hooks/create-calendar-rsvp-controller';
import type { CalendarEvent } from '../types';

/** One event response session shared by cards, agenda rows, and sidebar controls. */
export const [EventRsvpRoot, useEventRsvp] = createAssertedContextProvider(
  'EventRsvp',
  (props: ParentProps<{ event: CalendarEvent }>) => {
    const selfAttendee = createMemo(() =>
      props.event.attendees.find((attendee) => attendee.isSelf)
    );
    const canRespond = () =>
      props.event.viewerCan.rsvp &&
      selfAttendee() !== undefined &&
      !props.event.isCancelled;
    const recurring = () =>
      props.event.recurrenceLines.length > 0 ||
      props.event.recurrenceId !== undefined;
    const rsvp = createCalendarRsvpController(() =>
      canRespond()
        ? {
            eventId: props.event.eventId,
            respondingEmail: selfAttendee()?.email,
            occurrenceKey: props.event.occurrenceKey,
            recurrenceId: props.event.recurrenceId,
            recurring: recurring(),
          }
        : undefined
    );
    return { event: () => props.event, selfAttendee, canRespond, rsvp };
  }
);
