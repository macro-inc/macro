import { Button } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { DraftSyncViewState } from '../core/local-draft';

/** In-composer banner for draft failures and offline edits; saving itself stays silent. */
export function DraftSyncStatus(props: {
  state?: DraftSyncViewState;
  busy: boolean;
  error?: string;
  onRetry(): void;
  onReload(): void;
  onKeepEditing(): void;
}) {
  // Read `props.state` directly. A `<Show>` accessor throws when a child reads
  // it as the banner is removed, which left a recovered banner on screen.
  const detail = () => props.error ?? props.state?.detail;
  const action = () => props.state?.action;
  return (
    <Show when={props.state}>
      <div
        class="flex flex-wrap items-center gap-2 border-b border-edge-muted p-3 text-sm"
        role={props.state?.failed ? 'alert' : 'status'}
      >
        <div class="min-w-0 flex-1">
          <p>{props.state?.message}</p>
          <Show when={detail()}>
            <p class="text-xs text-ink-muted">{detail()}</p>
          </Show>
        </div>
        <Show when={action() || props.error}>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.busy}
            onClick={() =>
              action() === 'reload' ? props.onReload() : props.onRetry()
            }
          >
            {match(action())
              .with('retry-discard', () => 'Retry discard')
              .with('reload', () => 'Reload')
              .with('retry', undefined, () => 'Retry')
              .exhaustive()}
          </Button>
        </Show>
        <Show when={props.state?.canKeepEditing}>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.busy}
            onClick={props.onKeepEditing}
          >
            Keep editing
          </Button>
        </Show>
      </div>
    </Show>
  );
}
