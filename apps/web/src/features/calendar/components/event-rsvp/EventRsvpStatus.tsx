import SpinnerIcon from '@icon/system/regular/spinner-gap.svg';
import { Show } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';

export function EventRsvpStatus() {
  const response = useEventRsvp();
  return (
    <span role="status" class="size-3.5">
      <Show when={response.rsvp.pending()}>
        <SpinnerIcon
          aria-hidden="true"
          class="size-3.5 animate-spin motion-reduce:animate-none"
        />
        <span class="sr-only">Saving response…</span>
      </Show>
    </span>
  );
}
