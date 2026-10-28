import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import { Button, Checkbox } from '@ui';
import { For, Show } from 'solid-js';
import type { DocumentNoteLink, NoteRead, NoteTeam } from '../core/types';

export function DocumentNotesSection(props: {
  state: NoteRead<DocumentNoteLink[]>;
  team: NoteRead<NoteTeam | null>;
  selected?: DocumentNoteLink;
  saving: boolean;
  error?: string;
  onSelect: (link: DocumentNoteLink | undefined) => void;
  onRemove: () => void;
  onTeam: (link: DocumentNoteLink, teamId?: string) => void;
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
          People who can see a meeting’s details can read this note.
        </p>
        <Show when={props.state.pending}>
          <p role="status" class="mt-3 text-xs text-ink-muted">
            Loading meeting access…
          </p>
        </Show>
        <Show when={props.state.error || props.team.error}>
          <div
            role="alert"
            class="mt-3 flex items-center justify-between gap-3 text-xs text-failure"
          >
            {props.state.error || props.team.error}
            <Button size="sm" variant="ghost" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        </Show>
        <Show when={props.error}>
          <p role="alert" class="mt-3 text-xs text-failure">
            {props.error}
          </p>
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
                    · Can view
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
              <Show when={props.team.data}>
                {(team) => (
                  <Checkbox
                    checked={link.team?.id === team().id}
                    disabled={props.saving}
                    onChange={(checked) =>
                      props.onTeam(link, checked ? team().id : undefined)
                    }
                    class="mt-3 gap-2"
                  >
                    <Checkbox.Control />
                    <Checkbox.Label class="text-xs font-normal text-ink-muted">
                      Also share with {team().name}
                    </Checkbox.Label>
                  </Checkbox>
                )}
              </Show>
              <Show
                when={
                  link.team &&
                  props.team.data !== undefined &&
                  link.team.id !== props.team.data?.id
                }
              >
                <div class="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
                  <span>{link.team?.name} can also view this note.</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={props.saving}
                    onClick={() => props.onTeam(link, undefined)}
                  >
                    Remove team access
                  </Button>
                </div>
              </Show>
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
