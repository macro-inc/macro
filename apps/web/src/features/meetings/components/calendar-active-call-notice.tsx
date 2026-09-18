import { Button } from '@ui';
import { Show } from 'solid-js';

export function CalendarActiveCallNotice(props: {
  title: string;
  description: string;
  pending?: boolean;
  error?: boolean;
  onJoin: () => void;
  onShowCalls: () => void;
}) {
  return (
    <section aria-label="Active call" class="min-w-0 rounded-lg bg-hover p-3">
      <div class="flex items-center gap-2">
        <span class="size-2 shrink-0 rounded-full bg-success" />
        <span
          class="min-w-0 truncate text-sm font-medium text-ink"
          title={props.title}
        >
          {props.title}
        </span>
      </div>
      <p class="mt-1 text-xs text-ink-muted">{props.description}</p>
      <Show when={props.error}>
        <p role="alert" class="mt-2 text-xs text-failure">
          Could not open call. Please try again.
        </p>
      </Show>
      <div class="mt-3 flex items-center justify-between gap-2">
        <Button size="sm" onClick={props.onShowCalls}>
          See in Calls
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={props.pending}
          onClick={props.onJoin}
        >
          {props.pending ? 'Joining…' : 'Join'}
        </Button>
      </div>
    </section>
  );
}
