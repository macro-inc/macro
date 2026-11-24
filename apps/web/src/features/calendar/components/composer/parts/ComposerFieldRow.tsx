import { cn } from '@ui';
import type { JSX, ParentProps } from 'solid-js';

/** Shared icon/value alignment for desktop and phone composer fields. */
export function ComposerFieldRow(
  props: ParentProps<{ icon?: JSX.Element; class?: string; size?: 'sm' | 'md' }>
) {
  return (
    <div
      class={cn(
        'grid min-w-0 items-start gap-x-3',
        props.size === 'md'
          ? 'grid-cols-[20px_minmax(0,1fr)] py-0.5'
          : 'grid-cols-[18px_minmax(0,1fr)] py-[3px]',
        props.class
      )}
    >
      <span
        aria-hidden="true"
        class={cn(
          'flex items-center justify-center text-ink-muted',
          props.size === 'md' ? 'h-8' : 'h-7'
        )}
      >
        {props.icon}
      </span>
      <div class="min-w-0">{props.children}</div>
    </div>
  );
}
