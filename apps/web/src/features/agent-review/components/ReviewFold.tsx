import ArrowDownIcon from '@phosphor/arrow-down.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import type { ExpandedContext, ReaderItem } from '../core/reader-items';

export function ReviewFold(props: {
  fold: Extract<ReaderItem, { kind: 'fold' }>;
  rows: number;
  onExpand: (range: ExpandedContext) => void;
}) {
  return (
    <div class="flex h-7 items-center gap-1 border-y border-edge-muted/50 bg-panel px-3 text-[11px] text-ink-subtle">
      <Show when={props.fold.start > 0 && props.fold.count > 10}>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Show 10 lines below"
          onClick={() =>
            props.onExpand([props.fold.start, props.fold.start + 9])
          }
        >
          <ArrowDownIcon />
        </Button>
      </Show>
      <button
        type="button"
        class="min-w-0 flex-1 truncate px-1 text-left outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
        onClick={() => props.onExpand([props.fold.start, props.fold.end])}
      >
        {props.fold.count.toLocaleString()} unchanged lines
      </button>
      <Show when={props.fold.end + 1 < props.rows && props.fold.count > 10}>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Show 10 lines above"
          onClick={() => props.onExpand([props.fold.end - 9, props.fold.end])}
        >
          <ArrowUpIcon />
        </Button>
      </Show>
    </div>
  );
}
