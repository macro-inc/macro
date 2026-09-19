import NoteIcon from '@phosphor/note.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import type { NoteAnchor, ReviewNote } from '../core/review-notes';

/** The editor for a new note on one line. */
function NoteEditor(props: {
  anchor: NoteAnchor;
  onAdd: (anchor: NoteAnchor, text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = createSignal('');
  let textarea!: HTMLTextAreaElement;
  onMount(() => textarea.focus());
  const add = () => props.onAdd(props.anchor, text());
  return (
    <div class="flex flex-col gap-1.5">
      <textarea
        ref={textarea}
        class="min-h-13 w-full resize-y rounded-md border border-edge bg-input px-2 py-1.5 font-sans text-xs text-ink outline-none placeholder:text-ink-placeholder focus:border-input-focus"
        placeholder="What should the agent change here?"
        aria-label="Review note"
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancel();
          } else if (
            event.key === 'Enter' &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            add();
          }
        }}
      />
      <div class="flex items-center gap-1.5">
        <Button
          variant="cta"
          size="xs"
          class="h-6.5 px-2.5"
          disabled={text().trim() === ''}
          onClick={add}
        >
          Add note
        </Button>
        <Button
          variant="outline"
          size="xs"
          class="h-6.5 px-2.5"
          onClick={() => props.onCancel()}
        >
          Cancel
        </Button>
        <span class="flex-1" />
        <span class="text-[11px] text-ink-placeholder">
          Notes go to the agent, not to GitHub.
        </span>
      </div>
    </div>
  );
}

/**
 * What hangs under an annotated line: the notes already left there, and the
 * editor when the reviewer is writing another.
 */
export function NoteAnnotation(props: {
  notes: ReviewNote[];
  composing: NoteAnchor | undefined;
  onAdd: (anchor: NoteAnchor, text: string) => void;
  onCancel: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div class="flex flex-col gap-2 border-y border-edge-muted bg-surface-1 py-2 pr-2.5 pl-8 font-sans text-xs leading-normal text-ink-muted">
      <For each={props.notes}>
        {(note) => (
          <div class="flex items-start gap-2">
            <span class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-violet text-accent-contrast">
              <NoteIcon class="size-3" />
            </span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap wrap-break-word">
              {note.text}
              <span
                class={cn(
                  'ml-1 text-[11px]',
                  note.sentAt ? 'text-ink-placeholder' : 'text-accent'
                )}
              >
                · {note.sentAt ? 'sent to agent' : 'queued for the agent'}
              </span>
            </span>
            <Show when={!note.sentAt}>
              <Button
                variant="ghost"
                size="icon-xs"
                tooltip="Remove note"
                onClick={() => props.onRemove(note.id)}
              >
                <XIcon />
              </Button>
            </Show>
          </div>
        )}
      </For>
      <Show when={props.composing}>
        {(anchor) => (
          <NoteEditor
            anchor={anchor()}
            onAdd={props.onAdd}
            onCancel={props.onCancel}
          />
        )}
      </Show>
    </div>
  );
}
