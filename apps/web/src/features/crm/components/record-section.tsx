import type { JSX, ParentProps } from 'solid-js';
import { Show } from 'solid-js';

/** A full-height record tab: a title row with actions above scrolling content. */
export function RecordSection(
  props: ParentProps<{ title: string; actions?: JSX.Element }>
) {
  return (
    <div class="flex size-full min-h-0 flex-col">
      <div class="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
        <h2 class="text-sm font-medium text-ink-muted">{props.title}</h2>
        <Show when={props.actions}>
          <div class="ml-auto flex shrink-0 items-center gap-2.5">
            {props.actions}
          </div>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {props.children}
      </div>
    </div>
  );
}
