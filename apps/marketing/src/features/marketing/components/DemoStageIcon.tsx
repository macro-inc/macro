import { cn } from '@ui';

/** Frozen stage marks for the public sample board. */
export function CrmStageIcon(props: {
  optionId: string;
  index?: number;
  class?: string;
}) {
  const tint = () =>
    props.index === 1
      ? 'text-task'
      : props.index === 2
        ? 'text-note'
        : 'text-ink-muted';
  return (
    <svg
      viewBox="0 0 12 12"
      class={cn('size-3', props.class, tint())}
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4" fill="currentColor" />
    </svg>
  );
}
