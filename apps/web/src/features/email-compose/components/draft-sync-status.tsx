import { Show } from 'solid-js';
import type { DraftSyncViewState } from '../core/local-draft';

/** Durable recovery remains visible after remounting a failed draft. */
export function DraftSyncStatus(props: {
  state?: DraftSyncViewState;
  busy: boolean;
  error?: string;
  onRetry(): void;
  onDiscard(): void;
  onKeepEditing(): void;
}) {
  return (
    <Show when={props.state}>
      {(state) => (
        <div
          class="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-ink-muted"
          role={state().failed ? 'alert' : 'status'}
        >
          <span>{state().message}</span>
          <Show when={state().detail}>
            <span>{state().detail}</span>
          </Show>
          <Show when={state().action}>
            <button
              class="underline"
              disabled={props.busy}
              onClick={props.onRetry}
            >
              {state().action === 'retry-discard'
                ? 'Retry discard'
                : state().action === 'save'
                  ? 'Save now'
                  : 'Retry'}
            </button>
          </Show>
          <Show when={state().canKeepEditing}>
            <button
              class="underline"
              disabled={props.busy}
              onClick={props.onKeepEditing}
            >
              Keep editing
            </button>
          </Show>
          <Show when={state().canDiscard}>
            <button
              class="underline"
              disabled={props.busy}
              onClick={props.onDiscard}
            >
              Discard
            </button>
          </Show>
          <Show when={props.error}>
            <span role="alert">{props.error}</span>
          </Show>
        </div>
      )}
    </Show>
  );
}
