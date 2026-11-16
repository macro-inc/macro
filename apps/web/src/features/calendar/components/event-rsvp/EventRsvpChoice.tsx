import { Button } from '@ui';
import type { ParentProps } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';
import type { CalendarRsvpResponse } from '../../hooks/create-calendar-rsvp-controller';

/** A text-only response; its selection follows the optimistic event cache. */
export function EventRsvpChoice(
  props: ParentProps<{
    response: CalendarRsvpResponse;
    size?: 'sm' | 'md';
  }>
) {
  const response = useEventRsvp();
  return (
    <Button
      variant="ghost"
      size={props.size ?? 'sm'}
      class="bg-ink/5 px-3 aria-pressed:bg-accent-bg aria-pressed:text-accent mobile:min-h-11"
      aria-pressed={response.selfAttendee()?.responseStatus === props.response}
      disabled={!response.canRespond()}
      onClick={() => response.rsvp.respond(props.response)}
    >
      {props.children}
    </Button>
  );
}
