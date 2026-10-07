import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import FileIcon from '@phosphor/file.svg';
import FolderIcon from '@phosphor/folder.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import XIcon from '@phosphor/x.svg';
import { Button, EntityComposer } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { FolderUpload } from '../core/folder-composer';

false && fileFolderDrop;

export function FolderComposer(props: {
  name: string;
  destination: string;
  files: FolderUpload[];
  tags: JSX.Element;
  busy: boolean;
  preparing: boolean;
  created: boolean;
  error?: string;
  onName(value: string): void;
  onRemove(file: FolderUpload): void;
  onFiles(): void;
  onFolder(): void;
  onDrop(
    files: FileSystemFileEntry[],
    folders: FileSystemDirectoryEntry[]
  ): void;
  onClear(): void;
  onClose(): void;
  onExpand?(): void;
  onSubmit(): void;
}) {
  const [dragging, setDragging] = createSignal(false);
  let nameInput: HTMLInputElement | undefined;
  return (
    <form
      class="h-full min-h-0"
      aria-label="New folder"
      aria-busy={props.busy}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey) &&
          !event.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          props.onSubmit();
        }
      }}
    >
      <EntityComposer.Root>
        <EntityComposer.Header>
          <div class="flex-1 flex items-center">
            <Show when={props.onExpand}>
              <Button
                tabIndex={-1}
                size="icon-composer"
                aria-label="Continue editing in split"
                tooltip="Continue editing in split"
                disabled={props.busy}
                onClick={props.onExpand}
              >
                <ArrowsOutIcon />
              </Button>
            </Show>
          </div>
          <Show when={!props.created}>
            <Button
              tabIndex={-1}
              size="sm"
              variant="outline"
              depth={3}
              disabled={props.busy}
              onClick={() => {
                props.onClear();
                nameInput?.focus();
              }}
            >
              Clear Draft
            </Button>
          </Show>
          <Button
            tabIndex={-1}
            size="icon-composer"
            aria-label="Close"
            tooltip="Close"
            disabled={props.busy}
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        </EntityComposer.Header>
        <EntityComposer.Main class="gap-4">
          <EntityComposer.Title class="mb-0">
            <input
              ref={nameInput}
              autofocus
              aria-label="Folder name"
              placeholder="Folder name"
              required
              class="ph-no-capture w-full min-w-0 text-xl/7 font-medium outline-none bg-transparent placeholder:text-ink-placeholder"
              value={props.name}
              disabled={props.busy || props.created}
              onInput={(event) => props.onName(event.currentTarget.value)}
            />
          </EntityComposer.Title>
          <fieldset
            disabled={props.busy || props.created}
            class="px-2 disabled:pointer-events-none disabled:opacity-60"
          >
            <EntityComposer.Properties>{props.tags}</EntityComposer.Properties>
          </fieldset>
          <div
            class="mx-2 flex min-h-60 flex-1 flex-col overflow-auto rounded-lg border border-dashed border-edge-muted p-4"
            classList={{ 'bg-hover': dragging() }}
            use:fileFolderDrop={{
              disabled: props.busy,
              onDrop: props.onDrop,
              onDragStart: setDragging,
              onDragEnd: () => setDragging(false),
            }}
          >
            <div class="flex min-h-44 flex-1 flex-col items-center justify-center gap-3 text-center">
              <UploadIcon class="size-8 text-ink-extra-muted" />
              <div>
                <p class="text-sm text-ink">
                  Drop files or nested folders here
                </p>
                <p class="mt-1 text-xs text-ink-muted">
                  Add everything you want inside this folder.
                </p>
              </div>
              <div class="flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busy}
                  onClick={props.onFiles}
                >
                  Add files
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.busy}
                  onClick={props.onFolder}
                >
                  Add folder
                </Button>
              </div>
              <Show when={props.preparing}>
                <p role="status" class="text-xs text-ink-muted">
                  Preparing files…
                </p>
              </Show>
            </div>
            <Show when={props.files.length}>
              <ul
                aria-label="Folder contents"
                class="mt-4 flex flex-col gap-1 border-t border-edge-muted pt-3"
              >
                <For each={props.files}>
                  {(entry) => (
                    <li class="flex min-w-0 items-center gap-2 text-sm">
                      <Show
                        when={entry.isFolder}
                        fallback={
                          <FileIcon class="size-4 shrink-0 text-ink-muted" />
                        }
                      >
                        <FolderIcon class="size-4 shrink-0 text-ink-muted" />
                      </Show>
                      <span
                        class="min-w-0 flex-1 truncate"
                        title={entry.file.name}
                      >
                        {entry.isFolder
                          ? entry.file.name.replace(/\.zip$/, '')
                          : entry.file.name}
                      </span>
                      <Button
                        size="icon-sm"
                        aria-label={`Remove ${entry.file.name}`}
                        tooltip="Remove"
                        disabled={props.busy}
                        onClick={() => props.onRemove(entry)}
                      >
                        <XIcon />
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </EntityComposer.Main>
        <Show when={props.error}>
          <p role="alert" class="px-2 text-sm text-failure">
            {props.error}
          </p>
        </Show>
        <EntityComposer.Footer class="items-center">
          <span class="flex min-w-0 items-center gap-1.5 px-2 text-xs text-ink-muted">
            <FolderIcon class="size-4 shrink-0" />
            <span class="truncate" title={props.destination}>
              Inside {props.destination}
            </span>
          </span>
          <EntityComposer.Submit
            type="submit"
            hasContent={!!props.name.trim()}
            disabled={props.busy || !props.name.trim()}
          >
            {props.busy
              ? props.preparing
                ? 'Preparing…'
                : 'Creating…'
              : props.created
                ? 'Retry'
                : 'Create Folder'}
          </EntityComposer.Submit>
        </EntityComposer.Footer>
      </EntityComposer.Root>
    </form>
  );
}
