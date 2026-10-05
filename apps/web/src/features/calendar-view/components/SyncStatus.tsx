import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { Show } from 'solid-js';

/** Keep backfill progress visible while events arrive and the grid is usable. */
export function SyncStatus(props: { syncing: boolean }) {
  return (
    <Show when={props.syncing}>
      <div
        role="status"
        class="flex shrink-0 items-center gap-3 border-b border-edge-muted bg-surface px-4 py-3"
      >
        <SpinnerIcon class="size-4 shrink-0 animate-spin motion-reduce:animate-none text-accent" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm font-medium text-ink">
            Syncing your calendar…
          </span>
          <span class="text-xs text-ink-muted">
            Events are still being imported from Google. They’ll appear
            automatically. You can keep using Macro.
          </span>
        </div>
      </div>
    </Show>
  );
}
