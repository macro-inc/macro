import NoteIcon from '@phosphor/note.svg';
import { Button } from '@ui';

/** The composer-dock chip for notes that have not gone to the agent yet. */
export function ReviewNotesChip(props: {
  count: number;
  disabled?: boolean;
  onSend: () => void;
}) {
  return (
    <div
      class="flex items-center gap-2 rounded-[10px] bg-selected px-2.5 py-1.5 text-xs text-ink-muted shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-accent)_30%,transparent)]"
      role="status"
    >
      <NoteIcon class="size-3.5 shrink-0" />
      <span class="flex-1">
        <b class="font-semibold tabular-nums">{props.count}</b>{' '}
        {props.count === 1 ? 'review note' : 'review notes'} queued
      </span>
      <Button
        variant="ghost"
        size="xs"
        class="h-6 px-2 text-[11.5px] text-ink"
        disabled={props.disabled}
        onClick={() => props.onSend()}
      >
        Send to agent
      </Button>
    </div>
  );
}
