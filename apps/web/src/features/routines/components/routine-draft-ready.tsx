import CheckIcon from '@icon/system/regular/check.svg';
import { Button, Card } from '@ui';

/** A draft that finished while New routine was closed, waiting to be opened. */
export function RoutineDraftReady(props: {
  /** The drafted routine's name. */
  name: string;
  /** What was asked for. */
  request: string;
  onReview(): void;
  onDiscard(): void;
}) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="group"
      aria-label="Routine draft ready"
      class="flex-row flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3"
    >
      <CheckIcon class="size-4 shrink-0 text-success" />
      <div class="min-w-48 flex-1">
        <div class="truncate text-sm font-medium text-ink">
          Your draft is ready: {props.name}
        </div>
        <div class="truncate text-xs text-ink-muted">{props.request}</div>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <Button size="md" variant="ghost" onClick={() => props.onDiscard()}>
          Discard
        </Button>
        <Button size="md" variant="primary" onClick={() => props.onReview()}>
          Review
        </Button>
      </div>
    </Card>
  );
}
