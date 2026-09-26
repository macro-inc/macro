import SquareSplitHorizontalIcon from '@phosphor/square-split-horizontal.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { DiffCounts } from './DiffCounts';

/** Opens the changes pane and summarizes its added/deleted lines. */
export function ChangesToggleButton(props: {
  open: boolean;
  additions: number;
  deletions: number;
  /** A capture is running, so the counts may move. */
  capturing?: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={props.open}
      tooltip={props.open ? 'Hide the changes pane' : 'Show the changes pane'}
      // Sits beside the `h-7` pull request chip; the `sm` frame is 4px shorter.
      class={cn('h-7 gap-1.5', props.open && 'bg-active text-ink')}
      onClick={() => props.onToggle()}
    >
      <SquareSplitHorizontalIcon class="size-3.5" />
      <span>Changes</span>
      <Show when={props.additions > 0 || props.deletions > 0}>
        <span class={cn('text-xs', props.capturing && 'animate-pulse')}>
          <DiffCounts additions={props.additions} deletions={props.deletions} />
        </span>
      </Show>
    </Button>
  );
}
