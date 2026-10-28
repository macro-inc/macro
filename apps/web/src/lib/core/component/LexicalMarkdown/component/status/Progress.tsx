import { cn, Layer, Tooltip } from '@ui';
import { createMemo, Show } from 'solid-js';
import type { Store } from 'solid-js/store';
import type { ProgressStats } from '../../plugins';

type ProgressProps = {
  stats: Store<ProgressStats>;
  class?: string;
};

function useProgress(stats: Store<ProgressStats>) {
  const ratio = createMemo(() => {
    if (stats.total === 0) return 0;
    return Math.max(0, Math.min(1, stats.completed / stats.total));
  });

  const percentage = createMemo(() => `${ratio() * 100}%`);
  const count = createMemo(() => `${stats.completed}/${stats.total}`);
  const tooltip = createMemo(
    () =>
      `${stats.completed} out of ${stats.total} ${
        stats.total === 1 ? 'step' : 'steps'
      } complete`
  );

  return { percentage, count, tooltip };
}

export function ProgressMeter(props: ProgressProps) {
  const progress = useProgress(props.stats);

  return (
    <Show when={props.stats.total > 0}>
      <div class={cn('flex min-w-0 items-center gap-2', props.class)}>
        <div
          class="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-edge-muted"
          aria-hidden="true"
        >
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
            style={{ width: progress.percentage() }}
          />
        </div>
        <span class="shrink-0 tabular-nums text-ink-muted">
          {progress.count()}
        </span>
      </div>
    </Show>
  );
}

export function ProgressChip(props: ProgressProps) {
  const progress = useProgress(props.stats);

  return (
    <Show when={props.stats.total > 0}>
      <Layer depth={2}>
        <Tooltip label={progress.tooltip()} as="span">
          <div
            class={cn(
              'h-6 inline-flex min-w-0 items-center gap-1.5 rounded-full border border-edge-muted',
              'bg-surface px-2 py-1 leading-tight',
              props.class
            )}
            aria-label={progress.tooltip()}
          >
            <div
              class="h-1.5 w-14 overflow-hidden rounded-full bg-edge-muted"
              aria-hidden="true"
            >
              <div
                class="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: progress.percentage() }}
              />
            </div>
            <span class="shrink-0 tabular-nums text-ink-muted">
              {progress.count()}
            </span>
          </div>
        </Tooltip>
      </Layer>
    </Show>
  );
}
