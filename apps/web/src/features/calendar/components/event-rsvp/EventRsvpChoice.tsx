import { Button, type ButtonSize } from '@ui';
import type { ParentProps } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';
import type { CalendarRsvpResponse } from '../../hooks/create-calendar-rsvp-controller';

/** A text-only response; its selection follows the optimistic event cache. */
export function EventRsvpChoice(
  props: ParentProps<{
    response: CalendarRsvpResponse;
    size?: ButtonSize;
  }>
) {
  const response = useEventRsvp();
  return (
    <Button
      variant={
        response.selfAttendee()?.responseStatus === props.response
          ? 'accent'
          : 'secondary'
      }
      finish="flat"
      size={props.size ?? 'sm'}
      aria-pressed={response.selfAttendee()?.responseStatus === props.response}
      disabled={!response.canRespond()}
      onClick={() => response.rsvp.respond(props.response)}
    >
      {props.children}
    </Button>
  );
}
