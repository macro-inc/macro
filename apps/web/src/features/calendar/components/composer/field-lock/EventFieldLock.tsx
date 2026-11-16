import { Tooltip } from '@ui';
import { type ParentProps, Show } from 'solid-js';

/** Keep the reason for a disabled field reachable by pointer and keyboard. */
export function EventFieldLock(
  props: ParentProps<{ reason?: string; class?: string }>
) {
  return (
    <Show when={props.reason} fallback={props.children}>
      {(reason) => (
        <Tooltip as="span" label={reason()} tabIndex={0} class={props.class}>
          {props.children}
        </Tooltip>
      )}
    </Show>
  );
}
