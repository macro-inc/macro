import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';

/**
 * An unread count on the accent, where a section's unread dot would be.
 * Decorative: the control it marks describes the count to assistive
 * technology. `class` positions it and names the ring of the surface behind.
 */
export function UnreadCount(
  props: { label: string } & JSX.HTMLAttributes<HTMLSpanElement>
) {
  const [local, rest] = splitProps(props, ['label', 'class']);
  return (
    <span
      aria-hidden="true"
      class={cn(
        'pointer-events-none flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none tabular-nums text-surface ring-2',
        local.class
      )}
      {...rest}
    >
      {local.label}
    </span>
  );
}
