import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';

export function MessageLoadError(props: {
  children: JSX.Element;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      class="my-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted"
    >
      <p>{props.children}</p>
      <Show when={props.onRetry}>
        <Button
          size="sm"
          variant="secondary"
          disabled={props.retrying}
          onClick={props.onRetry}
        >
          Retry
        </Button>
      </Show>
    </div>
  );
}
