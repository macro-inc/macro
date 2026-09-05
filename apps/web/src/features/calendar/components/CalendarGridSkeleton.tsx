import { For, Show } from 'solid-js';

const SKELETON_TIME_ROWS = Array.from({ length: 12 });

/** Rendering-only placeholder for a loading time-grid calendar. */
export function CalendarGridSkeleton(props: {
  dayCount?: number;
  showDayHeader?: boolean;
  showAllDaySlot?: boolean;
}) {
  const days = () =>
    Array.from({
      length: Math.max(1, Math.floor(props.dayCount ?? 1)),
    });
  const dayColumns = () => `3rem repeat(${days().length}, minmax(0, 1fr))`;

  return (
    <div
      role="status"
      aria-label="Loading calendar"
      aria-busy="true"
      class="flex size-full min-w-0 min-h-0 animate-pulse flex-col overflow-hidden bg-surface"
    >
      <span class="sr-only">Loading calendar</span>

      <Show when={props.showDayHeader !== false}>
        <div
          class="grid shrink-0 border-b border-edge-muted"
          style={{ 'grid-template-columns': dayColumns() }}
        >
          <div />
          <For each={days()}>
            {() => (
              <div class="flex h-14 items-center justify-center border-l border-edge-muted">
                <div class="flex flex-col items-center gap-2">
                  <div class="h-2 w-10 rounded-full bg-skeleton" />
                  <div class="size-6 rounded-full bg-skeleton" />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.showAllDaySlot !== false}>
        <div
          class="grid shrink-0 border-b border-edge-muted"
          style={{ 'grid-template-columns': dayColumns() }}
        >
          <div class="flex h-12 items-center justify-end pr-2">
            <div class="h-2 w-7 rounded-full bg-skeleton" />
          </div>
          <For each={days()}>
            {() => (
              <div class="h-12 border-l border-edge-muted px-1 py-2">
                <div class="h-5 w-1/3 rounded bg-skeleton" />
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <div class="flex w-12 shrink-0 flex-col">
          <For each={SKELETON_TIME_ROWS}>
            {(_, index) => (
              <div class="relative min-h-8 flex-1 border-t border-edge-muted first:border-t-0">
                <div
                  class="absolute top-0 right-2 h-1.5 rounded-full bg-skeleton"
                  classList={{
                    'w-5': index() % 2 === 0,
                    'w-7': index() % 2 !== 0,
                  }}
                />
              </div>
            )}
          </For>
        </div>

        <div
          class="grid min-w-0 flex-1"
          style={{
            'grid-template-columns': `repeat(${days().length}, minmax(0, 1fr))`,
          }}
        >
          <For each={days()}>
            {(_, dayIndex) => (
              <div class="relative flex min-w-0 flex-col border-l border-edge-muted">
                <For each={SKELETON_TIME_ROWS}>
                  {() => (
                    <div class="min-h-8 flex-1 border-t border-edge-muted first:border-t-0" />
                  )}
                </For>

                <div
                  class="absolute inset-x-1 top-[18%] h-[14%] rounded-md bg-skeleton"
                  classList={{ hidden: dayIndex() % 2 !== 0 }}
                />
                <div
                  class="absolute inset-x-1 top-[54%] h-[9%] rounded-md bg-skeleton"
                  classList={{ hidden: days().length > 1 || dayIndex() !== 0 }}
                />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
