import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';

/**
 * Pane-level review controls: progress through the files, and the two bulk
 * actions that make the per-file controls discoverable in the first place.
 */
export function ReviewBar(props: {
  viewed: number;
  total: number;
  anyExpanded: boolean;
  allViewed: boolean;
  onToggleCollapsed: () => void;
  onToggleViewed: () => void;
}) {
  const percent = () =>
    props.total === 0 ? 0 : Math.round((props.viewed / props.total) * 100);
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-edge-muted bg-surface-1 py-1.5 pr-2 pl-3">
      <div class="flex items-center gap-2 text-xs text-ink-placeholder">
        <span>
          <b class="font-semibold tabular-nums text-ink-muted">
            {props.viewed}
          </b>{' '}
          of {props.total} files viewed
        </span>
        <span
          class="h-1 w-21 overflow-hidden rounded-full bg-edge-muted"
          role="progressbar"
          aria-label="Files viewed"
          aria-valuemin={0}
          aria-valuemax={props.total}
          aria-valuenow={props.viewed}
        >
          <span
            class="block h-full rounded-full bg-success transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${percent()}%` }}
          />
        </span>
      </div>
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
      <Button
        variant="outline"
        size="xs"
        class="h-6.5 gap-1.5 px-2 text-[11.5px]"
        tooltip={
          props.allViewed
            ? 'Clear every viewed mark'
            : 'Mark every file as viewed'
        }
        onClick={() => props.onToggleViewed()}
      >
        {props.allViewed ? (
          <XIcon class="size-3" />
        ) : (
          <CheckIcon class="size-3" />
        )}
        <span>{props.allViewed ? 'Clear viewed' : 'Mark all viewed'}</span>
      </Button>
    </div>
  );
}
