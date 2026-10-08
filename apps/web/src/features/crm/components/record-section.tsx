import type { JSX, ParentProps } from 'solid-js';
import { Show } from 'solid-js';

/** A named record tab with optional actions above scrolling content. */
export function RecordSection(
  props: ParentProps<{ title: string; actions?: JSX.Element }>
) {
  return (
    <section aria-label={props.title} class="flex size-full min-h-0 flex-col">
      <Show when={props.actions}>
        <div class="flex min-w-0 shrink-0 flex-wrap items-center gap-3 px-4 py-3">
          <div class="ml-auto flex shrink-0 items-center gap-2.5">
            {props.actions}
          </div>
        </div>
      </Show>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {props.children}
      </div>
    </section>
  );
}
