import type { ParentProps } from 'solid-js';

/** Keep heading icons and conversation statuses in the same fixed-width slot. */
export function PhoneListLeading(props: ParentProps) {
  return (
    <span class="flex size-5 shrink-0 items-center justify-center">
      {props.children}
    </span>
  );
}
