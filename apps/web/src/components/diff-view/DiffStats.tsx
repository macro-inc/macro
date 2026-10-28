import { For } from 'solid-js';
import { DiffCounts } from './DiffCounts';

/** Line totals and five textured squares showing their relative proportions. */
export function DiffStats(props: { additions: number; deletions: number }) {
  const additionSquares = () => {
    const total = props.additions + props.deletions;
    if (total === 0) return 0;
    if (props.deletions === 0) return 5;
    if (props.additions === 0) return 0;
    return Math.max(1, Math.min(4, Math.round((5 * props.additions) / total)));
  };

  return (
    <span
      role="img"
      aria-label={`${props.additions} ${props.additions === 1 ? 'addition' : 'additions'}, ${props.deletions} ${props.deletions === 1 ? 'deletion' : 'deletions'}`}
      class="inline-flex items-center gap-2"
    >
      <span aria-hidden="true">
        <DiffCounts additions={props.additions} deletions={props.deletions} />
      </span>
      <span aria-hidden="true" class="inline-flex gap-0.5">
        <For each={[0, 1, 2, 3, 4]}>
          {(index) => (
            <span
              class="size-2.5 shrink-0 rounded-sm ring-1 ring-inset ring-ink/20 bg-[image:repeating-linear-gradient(135deg,transparent_0_2px,color-mix(in_oklch,var(--color-ink)_15%,transparent)_2px_3px)]"
              classList={{
                'bg-edge-muted': props.additions + props.deletions === 0,
                'bg-success':
                  props.additions + props.deletions > 0 &&
                  index < additionSquares(),
                'bg-failure':
                  props.additions + props.deletions > 0 &&
                  index >= additionSquares(),
              }}
            />
          )}
        </For>
      </span>
    </span>
  );
}
