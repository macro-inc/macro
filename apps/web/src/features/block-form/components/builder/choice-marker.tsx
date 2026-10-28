import { cn } from '@ui';

/** Inert answer control preview; editing an option never selects an answer. */
export function ChoiceMarker(props: { multi: boolean }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'inline-block size-4 shrink-0 border-[1.5px] border-current text-ink-muted',
        props.multi ? 'rounded-xs' : 'rounded-full'
      )}
    />
  );
}
