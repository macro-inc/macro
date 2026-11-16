import { cn } from '@ui';
import type { JSX, ParentProps } from 'solid-js';

/** Shared icon/value alignment for desktop and phone composer fields. */
export function ComposerFieldRow(
  props: ParentProps<{ icon?: JSX.Element; class?: string }>
) {
  return (
    <div
      class={cn(
        'grid min-w-0 grid-cols-[18px_minmax(0,1fr)] items-start gap-x-3 py-[3px]',
        props.class
      )}
    >
      <span
        aria-hidden="true"
        class="flex h-7 items-center justify-center text-ink-muted"
      >
        {props.icon}
      </span>
      <div class="min-w-0">{props.children}</div>
    </div>
  );
}
