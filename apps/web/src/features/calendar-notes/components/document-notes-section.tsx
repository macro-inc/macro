import CalendarIcon from '@phosphor/calendar-blank.svg';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type { DocumentNoteLink, NoteRead } from '../core/types';

export function DocumentNotesSection(props: {
  state: NoteRead<DocumentNoteLink[]>;
  selected?: DocumentNoteLink;
  saving: boolean;
  error?: string;
  onSelect: (link: DocumentNoteLink | undefined) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <Show
      when={
        props.state.pending || props.state.error || props.state.data?.length
      }
    >
      <section
        aria-label="Meeting links"
        class="rounded-3xl bg-dialog p-4 text-sm text-ink"
      >
        <h3 class="font-medium">Meeting links</h3>
        <p class="mt-1 text-xs leading-relaxed text-ink-muted">
          Access granted through meeting links. Unlink removes these grants and
          keeps the document.
        </p>
        <Show when={props.state.pending}>
          <p role="status" class="mt-3 text-xs text-ink-muted">
            Loading meeting access…
          </p>
        </Show>
        <Show when={props.state.error}>
          <div
            role="alert"
            class="mt-3 flex items-center justify-between gap-3 text-xs text-failure"
          >
            {props.state.error}
            <Button size="sm" variant="ghost" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        </Show>
        <For each={props.state.data}>
          {(link) => (
            <div class="mt-3 rounded-xl border border-edge-muted p-3">
              <div class="flex items-start gap-3">
                <CalendarIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{link.eventTitle}</p>
                  <p class="mt-1 text-xs text-ink-muted">
                    {link.occurrenceKey === 'single'
                      ? 'One-time meeting'
                      : link.occurrenceKey.slice(0, 10)}{' '}
                    · Meeting viewers
                    {link.team ? ` + ${link.team.name}` : ''} · Can view
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.saving}
                  onClick={() => props.onSelect(link)}
                >
                  Unlink
                </Button>
              </div>
              <Show
                when={
                  props.selected?.eventId === link.eventId &&
                  props.selected?.occurrenceKey === link.occurrenceKey
                }
              >
                <div class="mt-3 border-t border-edge-muted pt-3">
                  <p class="text-xs text-ink-muted">
                    Remove this meeting link and its team access? The document
                    and its other sharing stay the same.
                  </p>
                  <Show when={props.error}>
                    <p role="alert" class="mt-2 text-xs text-failure">
                      {props.error}
                    </p>
                  </Show>
                  <div class="mt-3 flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.saving}
                      onClick={() => props.onSelect(undefined)}
                    >
                      Keep link
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={props.saving}
                      onClick={props.onRemove}
                    >
                      {props.saving ? 'Removing…' : 'Unlink meeting'}
                    </Button>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
