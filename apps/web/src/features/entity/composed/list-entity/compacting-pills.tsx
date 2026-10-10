import { cn } from '@ui';
import { createSignal, type JSX } from 'solid-js';
import { createPillCompaction } from './pill-compaction';

/**
 * A row of pills that gives way to the title: when the pills no longer fit,
 * each drops its text (anything marked `data-pill-text`) and they overlap
 * like a stack, keeping icons, dots, and their tooltips.
 */
export function CompactingPills(props: {
  class?: string;
  children: JSX.Element;
}) {
  const [element, setElement] = createSignal<HTMLElement>();
  // The row is marked `data-pill-row`; it is what the pills measure room against.
  const compaction = createPillCompaction(element, (pills) =>
    pills.closest('[data-pill-row]')
  );

  return (
    <span
      ref={setElement}
      data-compact={compaction.compact() ? '' : undefined}
      class={cn(
        'group/pills flex min-w-0 items-center gap-1 overflow-hidden',
        'data-compact:gap-0 data-compact:[&_[data-pill-text]]:hidden',
        // Pill groups render as `contents`, so their pills stack here too.
        'data-compact:[&>*+*]:-ml-1.5 data-compact:[&>.contents:not(:first-child)>*]:-ml-1.5 data-compact:[&>.contents>*+*]:-ml-1.5',
        '[&>*]:relative [&>.contents>*]:relative [&_*:hover]:z-10',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}
