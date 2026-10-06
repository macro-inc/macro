import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import type { DraftSyncViewState } from '../core/local-draft';

/** Durable recovery remains visible after remounting a failed draft. */
export function DraftSyncStatus(props: {
  state?: DraftSyncViewState;
  busy: boolean;
  error?: string;
  onRetry(): void;
  onKeepEditing(): void;
}) {
  const [showSaved, setShowSaved] = createSignal(false);
  const savedVersion = createMemo(() =>
    props.state?.failed || props.error ? undefined : props.state?.savedVersion
  );
  createEffect(() => {
    if (!savedVersion()) {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 2_000);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <Show when={props.state}>
      {(state) => (
        <div
          class="mr-2 flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-ink-muted"
          role={state().failed || props.error ? 'alert' : 'status'}
          title={
            state().failed || props.error
              ? (props.error ?? state().detail ?? state().message)
              : undefined
          }
        >
          <Show
            when={state().action || props.error}
            fallback={
              <span
                class="transition-opacity duration-200 motion-reduce:transition-none"
                classList={{ 'opacity-0': !showSaved() }}
                aria-hidden={!showSaved()}
              >
                {state().message}
              </span>
            }
          >
            <button
              type="button"
              class="text-failure-ink underline disabled:opacity-50"
              disabled={props.busy}
              onClick={props.onRetry}
            >
              {state().action === 'retry-discard' ? 'Retry discard' : 'Retry'}
            </button>
          </Show>
          <Show when={state().canKeepEditing}>
            <button
              type="button"
              class="underline"
              disabled={props.busy}
              onClick={props.onKeepEditing}
            >
              Keep editing
            </button>
          </Show>
          <Show when={state().failed || props.error}>
            <span class="sr-only">
              {props.error ?? state().detail ?? state().message}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}
