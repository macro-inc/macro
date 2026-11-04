import { cn } from '@ui';

/** Marks a name as an agent rather than a person. */
export function AgentTag(props: { class?: string }) {
  return (
    <span
      class={cn(
        'inline-flex shrink-0 items-center rounded-full bg-hover px-1.5 py-0.5',
        'text-xs font-medium leading-none text-ink-muted',
        props.class
      )}
    >
      Agent
    </span>
  );
}
