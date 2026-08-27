import { cn } from '@ui';

type MessageFlagProps = {
  text: string;
  /** Accent treatment for the unread ("New") marker. */
  highlight?: boolean;
  class?: string;
};

/**
 * Horizontal list divider with a centered label pill — used for day
 * boundaries and the unread marker. The hairline's left end lines up with
 * the thread rail column.
 */
export function MessageFlag(props: MessageFlagProps) {
  return (
    <div
      class={cn(
        'relative flex h-14 mobile:h-16 items-center justify-center px-2',
        props.class
      )}
    >
      {/* One hairline at an integer y-offset (flex-centering a 1px line in a
          56px row lands on a half pixel and renders soft/fat). Border-drawn
          like the rail so both strokes share one paint path. The label's
          background masks its middle. */}
      <div
        class={cn(
          'absolute top-7 mobile:top-8 h-0 border-t inset-x-0',
          props.highlight ? 'border-accent/40' : 'border-thread-rail'
        )}
      />
      {/* Plain label; its surface background carves the gap in the line. */}
      <span
        class={cn(
          'relative text-xs font-medium px-2.5 bg-surface',
          props.highlight ? 'text-accent' : 'text-ink-muted'
        )}
      >
        {props.text}
      </span>
    </div>
  );
}
