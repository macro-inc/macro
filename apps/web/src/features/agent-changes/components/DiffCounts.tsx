import { Show } from 'solid-js';

/** Numeric line totals shared by the viewer and its entry controls. */
export function DiffCounts(props: { additions: number; deletions: number }) {
  return (
    <Show when={props.additions > 0 || props.deletions > 0}>
      <span class="inline-flex shrink-0 items-center gap-2 font-mono tabular-nums">
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
