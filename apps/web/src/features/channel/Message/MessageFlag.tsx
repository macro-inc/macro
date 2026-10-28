import { cn } from '@ui';

type MessageFlagProps = {
  text: string;
  /** Accent treatment for the unread ("New") marker. */
  highlight?: boolean;
  class?: string;
};

/**
 * Horizontal list divider with a centered label — used for day boundaries
 * and the unread marker.
 */
export function MessageFlag(props: MessageFlagProps) {
  return (
    <div
      class={cn('flex h-14 mobile:h-16 items-center gap-2.5 px-2', props.class)}
    >
      <span
        aria-hidden="true"
        class={cn(
          'h-px grow',
          props.highlight ? 'bg-accent/40' : 'bg-thread-rail'
        )}
      />
      <span
        class={cn(
          'text-xs font-medium',
          props.highlight ? 'text-accent' : 'text-ink-muted'
        )}
      >
        {props.text}
      </span>
      <span
        aria-hidden="true"
        class={cn(
          'h-px grow',
          props.highlight ? 'bg-accent/40' : 'bg-thread-rail'
        )}
      />
    </div>
  );
}
