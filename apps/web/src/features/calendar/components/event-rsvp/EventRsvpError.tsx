import { Show } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';

export function EventRsvpError() {
  const response = useEventRsvp();
  return (
    <Show when={response.rsvp.error()}>
      {(error) => (
        <p role="alert" class="basis-full text-xs text-failure">
          {error()}
        </p>
      )}
    </Show>
  );
}
