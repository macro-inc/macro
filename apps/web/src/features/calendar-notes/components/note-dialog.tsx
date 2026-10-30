import CheckIcon from '@icon/system/regular/check.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Checkbox, Dialog, InputGroup } from '@ui';
import { For, Show } from 'solid-js';
import type { NoteDocument, NotePicker, NoteRead } from '../core/types';

export function NoteDialog(props: {
  kind: 'link' | 'unlink';
  eventTitle: string;
  recurring: boolean;
  guestListHidden?: boolean;
  picker: NoteRead<NotePicker>;
  query: string;
  onQuery: (query: string) => void;
  selected?: NoteDocument;
  onSelect: (document: NoteDocument) => void;
  linkedIds: string[];
  linksReady: boolean;
  teamId?: string;
  onTeam: (id: string | undefined) => void;
  saving: boolean;
  error?: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const title = () =>
    props.kind === 'unlink' ? 'Unlink meeting notes?' : 'Link meeting notes';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class={props.kind === 'link' ? 'w-[720px]' : 'w-[400px]'}
      contentOwnsScroll
      animate
    >
      <div
        class="relative flex min-h-0 max-h-[calc(100dvh-var(--virtual-keyboard-height,0px)-2rem)] flex-col p-4 sm:p-6"
        classList={{ 'h-[680px]': props.kind === 'link' }}
      >
        <div class="flex min-h-8 shrink-0 items-center justify-between gap-3 pr-8">
          <Dialog.Title class="text-base font-medium text-ink sm:text-sm">
            {title()}
          </Dialog.Title>
        </div>
        <Dialog.Description class="mt-1 shrink-0 text-sm leading-relaxed text-ink-muted sm:text-xs">
          <Show
            when={props.kind !== 'unlink'}
            fallback="The document stays in your files. Access granted by this meeting link will be removed; other sharing stays the same."
          >
            <span class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 truncate">{props.eventTitle}</span>
              <Show when={props.recurring}>
                <span class="shrink-0 text-xs text-ink-extra-muted">
                  · This occurrence
                </span>
              </Show>
            </span>
          </Show>
        </Dialog.Description>

        <Show when={props.kind === 'link'}>
          <div class="mt-3 shrink-0">
            <InputGroup size="md">
              <InputGroup.Addon>
                <MagnifyingGlassIcon class="size-4 text-ink-muted" />
              </InputGroup.Addon>
              <InputGroup.Input
                aria-label="Find a markdown document"
                placeholder="Find a note…"
                value={props.query}
                onInput={(event) => props.onQuery(event.currentTarget.value)}
                disabled={props.saving}
              />
            </InputGroup>
          </div>
          <div
            class="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain"
            role="region"
            aria-label="Your markdown documents"
            aria-busy={props.picker.pending}
          >
            <Show
              when={
                props.picker.pending && !props.picker.data?.documents.length
              }
            >
              <p role="status" class="px-3 py-5 text-sm text-ink-muted">
                Searching notes…
              </p>
            </Show>
            <Show when={props.picker.error}>
              <p role="alert" class="py-4 text-sm text-failure">
                {props.picker.error}
              </p>
            </Show>
            <For each={props.picker.data?.documents}>
              {(document) => {
                const linked = () =>
                  props.linkedIds.includes(document.documentId);
                return (
                  <Button
                    variant="ghost"
                    size="md"
                    fullWidth
                    aria-label={document.name}
                    tooltip={document.name}
                    aria-pressed={
                      props.selected?.documentId === document.documentId
                    }
                    disabled={linked() || props.saving}
                    onClick={() => props.onSelect(document)}
                  >
                    <FileTextIcon class="size-4 text-ink-extra-muted" />
                    <span class="min-w-0 flex-1 truncate text-left">
                      {document.name}
                    </span>
                    <Show when={linked()}>
                      <span class="text-xs text-ink-extra-muted">Linked</span>
                    </Show>
                    <Show
                      when={props.selected?.documentId === document.documentId}
                    >
                      <CheckIcon class="size-4" />
                    </Show>
                  </Button>
                );
              }}
            </For>
            <Show
              when={
                props.picker.data?.documents.length === 0 &&
                !props.picker.pending
              }
            >
              <p class="px-3 py-5 text-center text-sm text-ink-muted">
                {props.query
                  ? 'No notes match this name.'
                  : 'No markdown documents yet.'}
                <span class="mt-1 block text-xs text-ink-extra-muted">
                  Only notes you own can be shared with a meeting.
                </span>
              </p>
            </Show>
          </div>
        </Show>

        <Show when={props.kind !== 'link' && props.selected}>
          {(document) => (
            <div class="mt-3 flex shrink-0 items-center gap-2 rounded-lg bg-ink/4 p-3 text-sm text-ink">
              <FileTextIcon class="size-4 text-accent" />
              <span class="min-w-0 flex-1 truncate">{document().name}</span>
            </div>
          )}
        </Show>

        <Show when={props.kind !== 'unlink'}>
          <div
            role="region"
            aria-label="Note sharing"
            class="mt-3 shrink-0 border-t border-edge-muted pt-3"
          >
            <p class="text-xs leading-relaxed text-ink-muted">
              Anyone who can see this meeting’s details can read this note.
            </p>
            <Show when={props.picker.data?.teams.length}>
              <div class="mt-3 flex flex-col gap-2">
                <For each={props.picker.data?.teams}>
                  {(team) => (
                    <Checkbox
                      checked={props.teamId === team.id}
                      onChange={(checked) =>
                        props.onTeam(checked ? team.id : undefined)
                      }
                      disabled={props.saving}
                      class="min-h-9 justify-between gap-3"
                    >
                      <Checkbox.Control />
                      <Checkbox.Label class="flex-1 text-sm text-ink sm:text-xs">
                        Also share with {team.name}
                        <span class="mt-0.5 block text-xs font-normal text-ink-extra-muted">
                          Your team can read this note
                        </span>
                      </Checkbox.Label>
                    </Checkbox>
                  )}
                </For>
              </div>
            </Show>
            <Show when={props.guestListHidden}>
              <p class="mt-2 text-xs leading-relaxed text-ink-extra-muted">
                This meeting hides its guest list. Some guests may need a direct
                document share.
              </p>
            </Show>
          </div>
        </Show>

        <Show when={props.error}>
          <p role="alert" class="mt-3 shrink-0 text-sm text-failure">
            {props.error}
          </p>
        </Show>
        <div class="mt-4 flex shrink-0 justify-end gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={props.onClose}
            disabled={props.saving}
          >
            Cancel
          </Button>
          <Button
            variant={props.kind === 'unlink' ? 'danger' : 'primary'}
            size="md"
            onClick={props.onSave}
            disabled={
              !props.selected ||
              props.saving ||
              (props.kind === 'link' &&
                (!props.linksReady ||
                  props.linkedIds.includes(props.selected.documentId)))
            }
          >
            <Show when={props.kind === 'link'}>
              <LinkIcon class="size-4 shrink-0 touch:size-6" />
            </Show>
            {props.saving
              ? 'Saving…'
              : props.kind === 'unlink'
                ? 'Unlink note'
                : 'Link note'}
          </Button>
        </div>
        <Dialog.CloseButton
          as={Button}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          tooltip="Close"
          disabled={props.saving}
          class="absolute right-4 top-4 sm:right-6 sm:top-6"
        >
          <XIcon class="size-3.5 shrink-0 touch:size-6" />
        </Dialog.CloseButton>
      </div>
    </Dialog>
  );
}
