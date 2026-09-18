/** Numeric line totals shared by the viewer and its entry controls. */
export function DiffCounts(props: { additions: number; deletions: number }) {
  return (
    <span class="inline-flex shrink-0 items-center gap-2 font-mono tabular-nums">
      <span class="text-success">{`+${props.additions}`}</span>
      <span class="text-failure">{`−${props.deletions}`}</span>
    </span>
  );
}
