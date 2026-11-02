/**
 * The caret after an agent activity label that opens it: shown while the
 * row is hovered or focused, and always on touch, where nothing hovers.
 * Place it inside a `group` button.
 */

import CaretRight from '@icon/system/regular/caret-right.svg';

export function DisclosureCaret(props: { open: boolean }) {
  return (
    <CaretRight
      aria-hidden="true"
      class="size-4 shrink-0 opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100 touch:opacity-100 motion-reduce:transition-none"
      classList={{ 'rotate-90': props.open }}
    />
  );
}
