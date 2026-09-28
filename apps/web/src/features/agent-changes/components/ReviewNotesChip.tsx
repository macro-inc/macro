import CaretRightIcon from '@phosphor/caret-right.svg';
import NoteIcon from '@phosphor/note.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn } from '@ui';
import { Index, Show } from 'solid-js';
import {
  describeNoteLines,
  orderNotes,
  type ReviewNote,
  sendableNotes,
} from '../core/review-notes';

const LIST_ID = 'review-notes-dock-list';

/** The composer-dock chip for notes that have not gone to the agent yet. */
export function ReviewNotesChip(props: {
  notes: readonly ReviewNote[];
  expanded: boolean;
  disabled?: boolean;
  onToggleExpanded: () => void;
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onSend: () => void;
  onOpenNote?: (note: ReviewNote) => void;
}) {
  const notes = () => orderNotes(props.notes);
  const count = () => notes().length;
  const canSend = () => !props.disabled && sendableNotes(notes()).length > 0;
  return (
    <div
      class="flex flex-col rounded-[10px] bg-selected text-xs text-ink-muted shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-accent)_30%,transparent)]"
      role="group"
      aria-label="Queued review notes"
    >
      <div class="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={props.expanded}
          aria-controls={LIST_ID}
          title={
            props.expanded
              ? 'Hide queued notes'
              : 'Show queued notes so you can read and edit them'
          }
          onClick={() => props.onToggleExpanded()}
        >
          <CaretRightIcon
            class={cn(
              'size-3 shrink-0 transition-transform duration-100 motion-reduce:transition-none',
              props.expanded && 'rotate-90'
            )}
          />
          <NoteIcon class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1">
            <b class="font-semibold tabular-nums">{count()}</b>{' '}
            {count() === 1 ? 'review note' : 'review notes'} queued
          </span>
        </button>
        <Button
          variant="ghost"
          size="xs"
          class="h-6 px-2 text-[11.5px] text-ink"
          disabled={!canSend()}
          onClick={() => props.onSend()}
        >
          Send to agent
        </Button>
      </div>
      <Show when={props.expanded}>
        <ul
          id={LIST_ID}
          class="flex max-h-60 flex-col gap-2 overflow-y-auto border-t border-edge-muted px-2.5 py-2"
        >
          <Index each={notes()}>
            {(note) => (
              <li class="flex flex-col gap-1">
                <div class="flex items-center gap-1.5">
                  <Show
                    when={props.onOpenNote}
                    fallback={
                      <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-placeholder">
                        {note().path} · {describeNoteLines(note())}
                      </span>
                    }
                  >
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-ink-placeholder hover:text-ink"
                      title={`Show ${note().path} in the changes pane`}
                      onClick={() => props.onOpenNote?.(note())}
                    >
                      {note().path} · {describeNoteLines(note())}
                    </button>
                  </Show>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    tooltip="Remove note"
                    onClick={() => props.onRemove(note().id)}
                  >
                    <XIcon />
                  </Button>
                </div>
                <textarea
                  class="min-h-13 w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 font-sans text-xs text-ink outline-none placeholder:text-ink-placeholder focus:border-input-focus"
                  aria-label={`Review note on ${note().path}, ${describeNoteLines(note())}`}
                  value={note().text}
                  onInput={(event) =>
                    props.onUpdate(note().id, event.currentTarget.value)
                  }
                />
              </li>
            )}
          </Index>
        </ul>
      </Show>
    </div>
  );
}
