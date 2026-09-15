import SquareSplitHorizontalIcon from '@phosphor/square-split-horizontal.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';

/** The session header's control for the pane beside it, with the file count. */
export function ChangesToggleButton(props: {
  open: boolean;
  /** Changed files in the latest capture; hidden at zero. */
  count: number;
  /** A capture is running, so the count may move. */
  capturing?: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={props.open}
      tooltip={props.open ? 'Hide the changes pane' : 'Show the changes pane'}
      class={cn('gap-1.5 pr-1.5', props.open && 'bg-active text-ink')}
      onClick={() => props.onToggle()}
    >
      <SquareSplitHorizontalIcon class="size-3.5" />
      <span>Changes</span>
      <Show when={props.count > 0 || props.capturing}>
        <span
          class={cn(
            'inline-grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] tabular-nums',
            props.open
              ? 'bg-accent/20 text-accent'
              : 'bg-hover text-ink-subtle',
            props.capturing && 'animate-pulse'
          )}
        >
          {props.count}
        </span>
      </Show>
    </Button>
  );
}
