import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import { Button } from '@ui';

/** Stands in for a reply that is open in the app's reply window. */
export function ReplyInWindowNotice(props: { onShow: () => void }) {
  return (
    <div class="flex items-center gap-2 py-3 text-sm text-ink-muted">
      <ArrowSquareOut class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate">Reply open in a window</span>
      <Button variant="ghost" size="sm" onClick={() => props.onShow()}>
        Show
      </Button>
    </div>
  );
}
