import { Button, cn, Layer } from '@ui';
import type { ParentProps } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';
import type { CalendarRsvpResponse } from '../../hooks/create-calendar-rsvp-controller';

/** A text-only response; its selection follows the optimistic event cache. */
export function EventRsvpChoice(
  props: ParentProps<{
    response: CalendarRsvpResponse;
    size?: 'xs' | 'sm' | 'md';
  }>
) {
  const response = useEventRsvp();
  return (
    <Layer offset={0}>
      <span class="inline-flex rounded-full bg-surface">
        <Button
          variant={
            response.selfAttendee()?.responseStatus === props.response
              ? 'accent'
              : 'secondary'
          }
          finish="flat"
          size={props.size ?? 'sm'}
          class={cn('mobile:min-h-11', props.size !== 'xs' && 'px-3')}
          aria-pressed={
            response.selfAttendee()?.responseStatus === props.response
          }
          disabled={!response.canRespond()}
          onClick={() => response.rsvp.respond(props.response)}
        >
          {props.children}
        </Button>
      </span>
    </Layer>
  );
}
