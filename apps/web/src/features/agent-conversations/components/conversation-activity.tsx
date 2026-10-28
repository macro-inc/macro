import { Button } from '@ui';
import { Show } from 'solid-js';

/** Messages waiting their turn, and how the last attempt ended. */
export function ConversationActivity(props: {
  queued: number;
  failed?: 'failed' | 'stopped' | 'interrupted';
  canRetry: boolean;
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <Show when={props.queued > 0 || props.failed}>
      <div class="flex items-center justify-between gap-3 px-4 py-2 text-sm text-ink-muted">
        <div role="status" aria-live="polite">
          <Show when={props.queued > 0}>{props.queued} queued</Show>
          <Show when={props.queued === 0 && props.failed}>
            {props.failed === 'interrupted'
              ? 'Connection interrupted. Review any completed actions before retrying.'
              : props.failed === 'stopped'
                ? 'The last attempt was stopped.'
                : 'The last attempt could not finish.'}
          </Show>
        </div>
        <Show when={props.failed && props.canRetry}>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.pending}
            onClick={props.onRetry}
          >
            Retry message
          </Button>
        </Show>
      </div>
    </Show>
  );
}
