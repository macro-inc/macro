import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Button } from '@ui/components/Button';
import { For } from 'solid-js';

/** Records that could not be shown, with a way to ask again. */
export function DatabaseLoadFailure(props: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <WarningIcon class="size-7 text-ink-muted" />
      <p class="text-sm font-medium">{props.title}</p>
      <p class="max-w-96 text-xs text-ink-muted">{props.message}</p>
      <Button size="sm" class="gap-2" onClick={props.onRetry}>
        <ArrowClockwiseIcon class="size-3.5" />
        Try again
      </Button>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div
      class="flex-1 p-5"
      role="status"
      aria-label="Loading records"
      aria-busy="true"
    >
      <div class="mb-4 h-8 animate-pulse rounded bg-hover" />
      <For each={[0, 1, 2, 3, 4, 5]}>
        {() => <div class="mb-2 h-9 animate-pulse rounded bg-hover/60" />}
      </For>
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div
      class="flex flex-1 gap-3 overflow-hidden p-5"
      role="status"
      aria-label="Loading board"
      aria-busy="true"
    >
      <For each={[0, 1, 2]}>
        {() => (
          <div class="flex w-70 shrink-0 flex-col gap-2">
            <div class="h-7 w-24 animate-pulse rounded bg-hover" />
            <For each={[0, 1, 2]}>
              {() => <div class="h-20 animate-pulse rounded-lg bg-hover/60" />}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
