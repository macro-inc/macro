import { For, Show } from 'solid-js';

export type StatTile = { label: string; value: string; hint?: string };

/** The Responses tab's counts, from the ledger and the table. */
export function StatTiles(props: {
  tiles: readonly StatTile[];
  loading: boolean;
}) {
  return (
    <dl class="grid grid-cols-2 gap-2 @2xl/responses:grid-cols-4">
      <For each={props.tiles}>
        {(tile) => (
          <div class="flex flex-col gap-0.5 rounded-lg border border-edge-muted bg-surface px-3 py-2.5">
            <dt class="text-xs text-ink-muted">{tile.label}</dt>
            <dd class="text-xl font-semibold text-ink tabular-nums">
              <Show
                when={!props.loading}
                fallback={
                  <span class="inline-block h-6 w-10 animate-pulse rounded bg-hover" />
                }
              >
                {tile.value}
              </Show>
            </dd>
            <Show when={tile.hint}>
              <p class="text-[11px] text-ink-muted">{tile.hint}</p>
            </Show>
          </div>
        )}
      </For>
    </dl>
  );
}
