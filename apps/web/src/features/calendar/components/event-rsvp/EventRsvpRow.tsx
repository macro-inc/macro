import { cn } from '@ui/utils/classname';
import { type ParentProps, Show } from 'solid-js';
import { useEventRsvp } from '../../context/event-rsvp-context';

/** Layout belongs to the host; authorization remains shared by every placement. */
export function EventRsvpRow(props: ParentProps<{ class?: string }>) {
  const response = useEventRsvp();
  return (
    <Show when={response.canRespond()}>
      <div
        class={cn('flex flex-wrap items-center gap-x-3 gap-y-2', props.class)}
      >
        {props.children}
      </div>
    </Show>
  );
}
