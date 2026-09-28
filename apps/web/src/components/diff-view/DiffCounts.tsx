import { Show } from 'solid-js';

/** Added and deleted line totals, hidden when both are zero. */
export function DiffCounts(props: { additions: number; deletions: number }) {
  return (
    <Show when={props.additions > 0 || props.deletions > 0}>
      <span class="inline-flex shrink-0 items-center gap-2 tabular-nums">
        <Show when={props.additions > 0}>
          <span class="text-success">{`+${props.additions}`}</span>
        </Show>
        <Show when={props.deletions > 0}>
          <span class="text-failure">{`−${props.deletions}`}</span>
        </Show>
      </span>
    </Show>
  );
}
