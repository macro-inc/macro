import { cn } from '@ui';

export interface DateTileProps {
  month: string;
  day: string;
  color: string;
  compact?: boolean;
  class?: string;
}

/**
 * Month and day marker for a calendar event or search result.
 * @do Derive its labels from the event's exclusive date range.
 * @dont Replace the event's accessible date and time with this decoration.
 */
export function DateTile(props: DateTileProps) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex shrink-0 flex-col items-center justify-center rounded-lg',
        props.compact ? 'size-9' : 'size-11',
        props.class
      )}
      style={{
        'background-color': `color-mix(in srgb, ${props.color} 30%, var(--color-panel))`,
      }}
    >
      <span
        class="text-xxs font-semibold leading-3 tracking-[0.06em]"
        style={{ color: props.color }}
      >
        {props.month}
      </span>
      <span class="text-lg font-semibold leading-6 text-ink">{props.day}</span>
    </span>
  );
}
