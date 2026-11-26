import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { formatClock, formatCompactClock } from '../core/timer-clock';

/** A running timer's count with its red dot: `● 0:42:10`, or `● 42:10` compact. */
export function TimerCount(props: {
  seconds: number;
  compact?: boolean;
  /** A tinted chip, for a row or card beside the task's name. */
  chip?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <span
      class={cn(
        'inline-flex shrink-0 items-center gap-1 tabular-nums',
        props.chip &&
          'rounded-full bg-failure-bg px-1.5 text-xs font-medium text-failure-ink',
        props.class
      )}
    >
      <span
        aria-hidden="true"
        class="size-1.5 shrink-0 rounded-full bg-failure"
      />
      {props.compact
        ? formatCompactClock(props.seconds)
        : formatClock(props.seconds)}
    </span>
  );
}
