import ArrowsInSimpleIcon from '@phosphor/arrows-in-simple.svg';
import ArrowsOutSimpleIcon from '@phosphor/arrows-out-simple.svg';
import SidebarIcon from '@phosphor/sidebar-simple.svg';
import { Button } from '@ui';
import { describeFileCount } from '../core/changeset';

/** The file tree toggle and bulk collapse and expand controls. */
export function ReviewBar(props: {
  fileCount: number;
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
  anyExpanded: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-edge-muted bg-surface-1 py-1.5 pr-2 pl-2">
      <Button
        variant="outline"
        size="xs"
        class="h-6.5 gap-1.5 px-2 text-[11.5px]"
        aria-pressed={props.fileTreeOpen}
        tooltip={
          props.fileTreeOpen ? 'Hide the file tree' : 'Show the file tree'
        }
        onClick={() => props.onToggleFileTree()}
      >
        <SidebarIcon class="size-3.5" />
        <span>{describeFileCount(props.fileCount)}</span>
      </Button>
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
