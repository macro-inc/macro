import { cn } from '@ui';
import type { JSX, ParentProps } from 'solid-js';

export type SheetRowProps = ParentProps & {
  icon?: JSX.Element;
  class?: string;
};

/** A sheet row with a stable icon gutter and a freely composed value column. */
export function SheetRow(props: SheetRowProps) {
  return (
    <div
      class={cn(
        'grid min-h-11 grid-cols-[18px_minmax(0,1fr)] items-center gap-x-3 px-3',
        props.class
      )}
    >
      <span
        aria-hidden="true"
        class="flex w-[18px] items-center justify-center text-ink-muted"
      >
        {props.icon}
      </span>
      <div class="min-w-0 text-base leading-[22px] text-ink">
        {props.children}
      </div>
    </div>
  );
}
