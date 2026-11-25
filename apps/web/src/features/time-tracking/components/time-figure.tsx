import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { type JSX, Show } from 'solid-js';

/** One headline number of a report, with what it counts above it. */
export function TimeFigure(props: {
  label: string;
  value: string | undefined;
}): JSX.Element {
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <span class="truncate text-xs text-ink-muted">{props.label}</span>
      <Show
        when={props.value}
        fallback={<ListSkeleton.Bar class="my-1 h-6 w-20" />}
      >
        {(value) => (
          <span class="text-2xl font-semibold tabular-nums">{value()}</span>
        )}
      </Show>
    </div>
  );
}
