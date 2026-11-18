import { Button } from '@ui';

/** Recovery for a missing conversation or failed channel lookup. */
export function ChannelUnavailable(props: {
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <div
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-ink-muted"
      role="status"
    >
      <h2>Conversation unavailable</h2>
      <Button
        variant="ghost"
        size="sm"
        disabled={props.busy}
        onClick={props.onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
