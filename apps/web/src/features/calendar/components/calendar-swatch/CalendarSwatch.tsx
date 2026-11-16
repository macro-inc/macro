import { cn } from '@ui';

export interface CalendarSwatchProps {
  color: string;
  compact?: boolean;
  class?: string;
}

/**
 * A calendar's supplied color, without looking up the source.
 * @do Pass the resolved calendar color from the owning view.
 * @dont Use the swatch as the only accessible calendar label.
 */
export function CalendarSwatch(props: CalendarSwatchProps) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'inline-block shrink-0 rounded-[4px]',
        props.compact ? 'size-2.5' : 'size-3',
        props.class
      )}
      style={{ 'background-color': props.color }}
    />
  );
}
