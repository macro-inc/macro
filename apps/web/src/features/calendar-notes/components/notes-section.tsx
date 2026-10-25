import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import CaretDownIcon from '@phosphor/caret-down.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import { Button, Dropdown } from '@ui';
import { For, onCleanup, Show } from 'solid-js';
import type { MeetingNote, NoteRead } from '../core/types';

export function NotesSection(props: {
  state: NoteRead<MeetingNote[]>;
  creating: boolean;
  createdUnlinked: boolean;
  createError?: string;
  onCreate: () => void;
  onOpenSaved: () => void;
  dialogOpen: boolean;
  onMenuChange: (documentId: string, open: boolean) => void;
  onLink: () => void;
  onOpen: (note: MeetingNote) => void;
  onSharing: (note: MeetingNote) => void;
  onUnlink: (note: MeetingNote) => void;
  onRetry: () => void;
}) {
  const createLabel = () =>
    props.creating
      ? props.createdUnlinked
        ? 'Linking…'
        : 'Creating…'
      : props.createdUnlinked
        ? 'Retry linking'
        : 'Create notes';

  return (
    <section
      aria-label="Meeting notes"
      class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 border-t border-edge-muted px-4 py-3 text-sm text-ink-muted sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-3 sm:text-xs"
    >
      <FileTextIcon class="mt-2 size-5 text-ink-extra-muted sm:mt-1.5 sm:size-4" />
      <div class="min-w-0">
        <div class="mb-1 flex min-h-7 items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="whitespace-nowrap font-medium text-ink">
              Meeting notes
            </h3>
            <Show when={props.state.data?.length}>
              <span class="text-xs text-ink-extra-muted">
                {props.state.data?.length}
              </span>
            </Show>
          </div>
          <Show when={props.state.data}>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                variant={props.state.data?.length ? 'ghost' : 'strong'}
                size="xs"
                label={createLabel()}
                disabled={props.creating}
                onClick={props.onCreate}
              >
                {props.creating || props.createdUnlinked
                  ? createLabel()
                  : 'Create'}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                depth={3}
                label="Link existing"
                disabled={props.creating}
                onClick={props.onLink}
              >
                Link
              </Button>
            </div>
          </Show>
        </div>
        <Show when={props.state.pending && !props.state.data}>
          <div
            role="status"
            aria-label="Loading meeting notes"
            class="flex flex-col gap-2 py-2"
          >
            <ListSkeleton.Bar class="h-4 w-3/4" />
            <ListSkeleton.Bar class="h-3 w-1/2" />
          </div>
        </Show>
        <Show when={props.state.error}>
          <div
            role="alert"
            class="flex items-center justify-between gap-2 py-2 text-xs text-ink-muted"
          >
            <span>{props.state.error}</span>
            <Button size="sm" variant="outline" onClick={props.onRetry}>
              Retry
            </Button>
          </div>
        </Show>
        <div class="flex flex-col gap-1">
          <For each={props.state.data}>
            {(note) => {
              onCleanup(() => props.onMenuChange(note.documentId, false));
              return (
                <div class="min-w-0">
                  <div class="flex min-w-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      depth={3}
                      class="min-w-0 flex-1"
                      label={`Open ${note.name}`}
                      onClick={() => props.onOpen(note)}
                    >
                      <span class="min-w-0 flex-1 truncate text-left">
                        {note.name}
                      </span>
                    </Button>
                    <Show when={note.canManage}>
                      <Dropdown
                        modal={false}
                        placement="bottom-end"
                        onOpenChange={(open) =>
                          props.onMenuChange(note.documentId, open)
                        }
                      >
                        <Dropdown.Trigger
                          variant="ghost"
                          size="xs"
                          label={`Options for ${note.name}`}
                          disabled={props.creating}
                        >
                          Options
                          <CaretDownIcon />
                        </Dropdown.Trigger>
                        <Dropdown.Content
                          portalScope="local"
                          class="z-nested-action-menu min-w-44"
                          onCloseAutoFocus={(event) => {
                            if (props.dialogOpen) event.preventDefault();
                          }}
                        >
                          <Dropdown.Group>
                            <Dropdown.Item
                              onSelect={() => props.onSharing(note)}
                            >
                              Manage access
                            </Dropdown.Item>
                            <Dropdown.Item
                              onSelect={() => props.onUnlink(note)}
                            >
                              Unlink from meeting
                            </Dropdown.Item>
                          </Dropdown.Group>
                        </Dropdown.Content>
                      </Dropdown>
                    </Show>
                  </div>
                  <Show when={note.team}>
                    {(team) => (
                      <p class="px-2 text-xs text-ink-extra-muted sm:text-xxs">
                        Also shared with {team().name}
                      </p>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
        <Show when={props.createError}>
          <div role="alert" class="my-2 text-xs text-ink-muted">
            <p>{props.createError}</p>
            <Show when={props.createdUnlinked}>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.creating}
                onClick={props.onOpenSaved}
              >
                Open saved note
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
