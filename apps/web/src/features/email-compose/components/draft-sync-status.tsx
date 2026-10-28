import { Button } from '@ui';
import { Show } from 'solid-js';
import type { DraftSyncViewState } from '../core/local-draft';

/** In-composer banner for draft failures; saving itself stays silent. */
export function DraftSyncStatus(props: {
  state?: DraftSyncViewState;
  busy: boolean;
  error?: string;
  onRetry(): void;
  onKeepEditing(): void;
}) {
  return (
    <Show when={props.state}>
      {(state) => (
        <div
          class="flex flex-wrap items-center gap-2 border-b border-edge-muted p-3 text-sm"
          role="alert"
        >
          <div class="min-w-0 flex-1">
            <p>{state().message}</p>
            <Show when={props.error ?? state().detail}>
              {(detail) => <p class="text-xs text-ink-muted">{detail()}</p>}
            </Show>
          </div>
          <Show when={state().action || props.error}>
            <Button
              size="sm"
              variant="outline"
              disabled={props.busy}
              onClick={props.onRetry}
            >
              {state().action === 'retry-discard' ? 'Retry discard' : 'Retry'}
            </Button>
          </Show>
          <Show when={state().canKeepEditing}>
            <Button
              size="sm"
              variant="outline"
              disabled={props.busy}
              onClick={props.onKeepEditing}
            >
              Keep editing
            </Button>
          </Show>
        </div>
      )}
    </Show>
  );
}
