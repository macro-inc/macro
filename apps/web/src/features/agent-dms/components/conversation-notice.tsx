import { Button } from '@ui';
import { Show } from 'solid-js';

export function ConversationNotice(props: {
  state: 'loading' | 'error' | 'unavailable';
  onRetry: () => void;
}) {
  return (
    <div
      class="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-muted"
      role="status"
    >
      <span>
        {props.state === 'loading'
          ? 'Loading conversation…'
          : props.state === 'error'
            ? 'Could not load this conversation.'
            : 'This agent is no longer available to you. Your conversation is still here.'}
      </span>
      <Show when={props.state === 'error'}>
        <Button variant="ghost" size="sm" onClick={props.onRetry}>
          Try again
        </Button>
      </Show>
    </div>
  );
}
