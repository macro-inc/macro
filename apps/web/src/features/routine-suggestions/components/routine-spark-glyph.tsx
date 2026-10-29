import RepeatIcon from '@icon/system/regular/repeat.svg';
import { cn } from '@ui';

/**
 * The suggested-routines mark uses the shared repeat icon on a flat violet tile.
 */
export function RoutineSparkGlyph(props: {
  /** `sm` for sidebar rows, `lg` for the modal header. */
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden bg-violet-bg text-violet-ink ring-1 ring-violet/25 ring-inset',
        props.size === 'lg'
          ? 'size-11 rounded-xl'
          : props.size === 'md'
            ? 'size-8 rounded-lg'
            : 'size-7 rounded-lg',
        props.class
      )}
    >
      <RepeatIcon class={props.size === 'lg' ? 'size-6' : 'size-4'} />
    </span>
  );
}
