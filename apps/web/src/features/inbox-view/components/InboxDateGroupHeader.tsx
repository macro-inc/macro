import type { SoupGroupHeaderRow } from '@app/features/soup';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';

export function InboxDateGroupHeader(props: {
  row: SoupGroupHeaderRow;
  expanded: boolean;
  focused: boolean;
  onFocus: () => void;
  onToggle: () => void;
}) {
  return (
    <div id={props.row.id} role="row">
      <div role="gridcell">
        <button
          type="button"
          tabIndex={-1}
          aria-expanded={props.expanded}
          class={cn(
            'mx-2 flex h-8 w-[calc(100%-1rem)] items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-ink-muted hover:bg-list-hover',
            props.focused && 'bg-list-highlighted'
          )}
          onMouseMove={props.onFocus}
          onClick={props.onToggle}
        >
          <CaretRightIcon
            aria-hidden="true"
            class={cn(
              'size-2.5 shrink-0 transition-transform',
              props.expanded && 'rotate-90'
            )}
          />
          <span class="truncate">{props.row.label}</span>
          <Show when={props.row.count !== undefined}>
            <span class="shrink-0 text-ink-extra-muted tabular-nums">
              {props.row.count}
            </span>
          </Show>
        </button>
      </div>
    </div>
  );
}
