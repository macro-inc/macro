import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
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
      <div class="mb-4 flex gap-1.5">
        <ListSkeleton.Bar class="h-8 w-28" />
        <ListSkeleton.Bar class="h-8 w-20" />
      </div>
      <For each={[0, 1, 2, 3, 4, 5]}>
        {() => <ListSkeleton.Bar class="mb-2 h-9 w-full rounded-lg" />}
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
            <ListSkeleton.Bar class="h-6 w-24" />
            <For each={[0, 1, 2]}>
              {() => <ListSkeleton.Bar class="h-20 w-full rounded-xl" />}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
