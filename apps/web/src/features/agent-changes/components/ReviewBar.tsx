import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { describeFileCount } from '../core/changeset';

/** Bulk collapse and expand controls for the file diffs. */
export function ReviewBar(props: {
  anyExpanded: boolean;
  onToggleCollapsed: () => void;
  /** Shown when no file tree is on screen to carry the count. */
  fileCount?: number;
}) {
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-edge-muted bg-surface-1 py-1.5 pr-2 pl-3">
      <Show when={props.fileCount !== undefined}>
        <span class="text-[10px] tracking-[0.07em] text-ink-placeholder uppercase">
          {describeFileCount(props.fileCount ?? 0)}
        </span>
      </Show>
      <span class="flex-1" />
      <Button
        variant="outline"
        size="xs"
        class="h-6.5 gap-1.5 px-2 text-[11.5px]"
        tooltip={
          props.anyExpanded
            ? 'Hide every diff, keeping just the file headers'
            : 'Show every diff again'
        }
        onClick={() => props.onToggleCollapsed()}
      >
        {props.anyExpanded ? (
          <ArrowsInSimpleIcon class="size-3" />
        ) : (
          <ArrowsOutSimpleIcon class="size-3" />
        )}
        <span>{props.anyExpanded ? 'Collapse all' : 'Expand all'}</span>
      </Button>
    </div>
  );
}
