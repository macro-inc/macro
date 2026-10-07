import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { fileFolderDrop } from '@core/directive/fileFolderDrop';
import {
  handleFileFolderDrop,
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import CloudArrowUpIcon from '@phosphor/cloud-arrow-up.svg';
import FolderIcon from '@phosphor/folder.svg';
import FolderPlusIcon from '@phosphor/folder-plus.svg';
import XIcon from '@phosphor/x.svg';
import { refetchHistory } from '@queries/history/history';
import { refetchSoupEntity } from '@queries/soup/cache';
import { createProject } from '@queries/storage/projects';
import { Button, Checkbox, EntityComposer } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';

false && fileFolderDrop;

export type CreateFolderSubmission = {
  folderId: string;
  name: string;
};

export type CreateFolderComposerProps = {
  parentId: string | undefined;
  parentLabel: string;
  onClose(): void;
  onSubmit?(submission: CreateFolderSubmission): void;
  onContinueInSplit?(draft: { name: string; files: UploadInput[] }): void;
};

type QueuedFile = {
  id: string;
  entry: UploadInput;
  name: string;
};

let fileIdCounter = 0;

export function CreateFolderComposer(props: CreateFolderComposerProps) {
  const splitPanel = useSplitPanelOrThrow();

  const [name, setName] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [shareWithTeam, setShareWithTeam] = createSignal(true);
  const [queuedFiles, setQueuedFiles] = createSignal<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);

  let nameInput: HTMLInputElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  onMount(() => {
    splitPanel.handle.setDisplayName('New folder');
    nameInput?.focus();
    nameInput?.select();
  });

  const canSubmit = () => !pending() && name().trim().length > 0;

  const addFiles = (files: UploadInput[]) => {
    const newFiles = files.map((entry) => {
      const isEntry = 'isFolder' in entry;
      return {
        id: String(++fileIdCounter),
        entry,
        name: isEntry ? entry.file.name : entry.name,
      };
    });
    setQueuedFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleFileDrop = (
    fileEntries: FileSystemFileEntry[],
    folderEntries: FileSystemDirectoryEntry[]
  ) => {
    handleFileFolderDrop(fileEntries, folderEntries, (entries) => {
      addFiles(entries);
    });
  };

  const handleBrowseFiles = () => {
    openFilePicker({ multiple: true }, (files) => {
      addFiles(files);
    });
  };

  const handleBrowseFolders = () => {
    openFolderPicker({ multiple: true }, (files) => {
      handleFolderSelect(files, (entries) => {
        addFiles(entries);
      });
    });
  };

  const handleSubmit = async () => {
    if (!canSubmit()) return;

    const folderName = name().trim();
    setError(undefined);
    setPending(true);

    try {
      const folderId = await createProject({
        name: folderName,
        parentId: props.parentId,
        sharePermission: shareWithTeam() ? undefined : null,
        source: 'drive-composer',
      });

      if (!folderId) {
        setError('Could not create the folder. Please try again.');
        setPending(false);
        return;
      }

      const files = queuedFiles();
      if (files.length > 0) {
        const results = await uploadFiles(
          files.map((f) => f.entry),
          'dss',
          { projectId: folderId }
        );

        const successful = results.filter((r) => !r.failed);
        const failed = results.filter((r) => r.failed);

        for (const upload of successful) {
          if (!upload.pending && upload.type === 'document') {
            refetchSoupEntity(upload.documentId, 'document');
          }
          if (upload.pending && upload.type === 'folder') {
            upload.projectId.then((createdProjectId) => {
              if (createdProjectId) {
                refetchSoupEntity(createdProjectId, 'project', {
                  includeRoot: true,
                });
              }
            });
          }
        }

        if (failed.length > 0) {
          toast.alert(
            `${failed.length} file${failed.length > 1 ? 's' : ''} failed to upload`
          );
        }
      }

      refetchSoupEntity(folderId, 'project', {
        ownTouch: true,
        refreshGraphql: true,
      });
      refetchHistory();

      toast.success(`Created "${folderName}"`, {
        subtext: `In ${props.parentLabel}`,
      });

      props.onSubmit?.({ folderId, name: folderName });
      props.onClose();
    } catch (err) {
      console.error('Failed to create folder', err);
      setError('Could not create the folder. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      class="h-full min-h-0"
      aria-label="New folder"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          void handleSubmit();
        }
      }}
    >
      <EntityComposer.Root>
        <EntityComposer.Header>
          <div class="flex-1 flex items-center">
            <Show when={props.onContinueInSplit}>
              <Button
                tabIndex={-1}
                aria-label="Continue editing in split"
                tooltip="Continue editing in split"
                size="icon-composer"
                disabled={pending()}
                onClick={() =>
                  props.onContinueInSplit?.({
                    name: name(),
                    files: queuedFiles().map((f) => f.entry),
                  })
                }
              >
                <ArrowsOutIcon />
              </Button>
            </Show>
          </div>
          <Button
            tabIndex={-1}
            aria-label="Close"
            tooltip="Close"
            size="icon-composer"
            disabled={pending()}
            onClick={props.onClose}
          >
            <XIcon />
          </Button>
        </EntityComposer.Header>

        <EntityComposer.Main class="min-h-28 justify-between gap-4">
          <EntityComposer.Title>
            <span class="flex size-7 shrink-0 items-center justify-center text-ink-muted">
              <FolderIcon class="size-5" />
            </span>
            <input
              ref={nameInput}
              autofocus
              aria-label="Folder name"
              placeholder="Folder name"
              class="ph-no-capture w-full min-w-0 text-xl/7 font-medium outline-none bg-transparent placeholder:text-ink-placeholder"
              value={name()}
              required
              disabled={pending()}
              onInput={(e) => {
                setName(e.currentTarget.value);
                if (error()) setError(undefined);
              }}
            />
          </EntityComposer.Title>

          <div
            class="flex flex-col gap-3 rounded-xl border-2 border-dashed border-edge-muted p-6 transition-colors"
            classList={{
              'border-accent bg-accent-wash': isDragging(),
            }}
            use:fileFolderDrop={{
              onDragStart: () => setIsDragging(true),
              onDragEnd: () => setIsDragging(false),
              onDrop: handleFileDrop,
            }}
          >
            <div class="flex flex-col items-center justify-center gap-3 text-center">
              <div class="flex size-12 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
                <CloudArrowUpIcon class="size-6" />
              </div>
              <div class="space-y-1">
                <p class="text-sm font-medium text-ink">
                  Drag and drop files here
                </p>
                <p class="text-xs text-ink-muted">
                  or browse from your computer
                </p>
              </div>
              <div class="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  depth={3}
                  disabled={pending()}
                  onClick={handleBrowseFiles}
                >
                  Browse files
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  depth={3}
                  disabled={pending()}
                  onClick={handleBrowseFolders}
                >
                  Browse folders
                </Button>
              </div>
            </div>

            <Show when={queuedFiles().length > 0}>
              <div class="mt-2 space-y-1">
                <p class="text-xs font-medium text-ink-muted">
                  {queuedFiles().length} file
                  {queuedFiles().length > 1 ? 's' : ''} ready to upload
                </p>
                <div class="max-h-32 overflow-y-auto space-y-1">
                  <For each={queuedFiles()}>
                    {(file) => (
                      <div class="flex items-center gap-2 rounded-md bg-surface-muted px-2 py-1 text-xs">
                        <span class="min-w-0 flex-1 truncate">{file.name}</span>
                        <button
                          type="button"
                          class="shrink-0 text-ink-muted hover:text-ink"
                          onClick={() => removeFile(file.id)}
                          disabled={pending()}
                        >
                          <XIcon class="size-3" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            class="hidden"
            multiple
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              if (files.length > 0) addFiles(files);
              e.currentTarget.value = '';
            }}
          />

          <Button
            type="button"
            variant="ghost"
            depth={2}
            class="w-full justify-start gap-2 text-sm"
            disabled={pending()}
            onClick={() => {
              toast.alert('Add from Macro coming soon');
            }}
          >
            <FolderPlusIcon class="size-4" />
            Add from Macro
          </Button>
        </EntityComposer.Main>

        <Show when={error()}>
          {(err) => (
            <p
              role="alert"
              class="border-t border-edge-muted px-2 pt-3 text-sm text-failure"
            >
              {err()}
            </p>
          )}
        </Show>

        <EntityComposer.Footer class="items-center flex-wrap">
          <Checkbox
            checked={shareWithTeam()}
            disabled={pending()}
            onChange={setShareWithTeam}
          >
            <Checkbox.Control />
            <Checkbox.Label class="text-xs text-ink-muted font-normal whitespace-nowrap">
              Share with my team
            </Checkbox.Label>
          </Checkbox>
          <EntityComposer.Submit
            type="submit"
            class="ml-auto"
            hasContent={Boolean(name().trim())}
            disabled={pending() || !name().trim()}
          >
            Create Folder
          </EntityComposer.Submit>
        </EntityComposer.Footer>
      </EntityComposer.Root>
    </form>
  );
}

export function CreateFolderComposerView(props: {
  parentId?: string;
  parentLabel?: string;
  onSubmit?(submission: CreateFolderSubmission): void;
}) {
  const splitPanel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();

  const handleClose = () => {
    splitPanel.handle.close();
  };

  const handleContinueInSplit = (draft: {
    name: string;
    files: UploadInput[];
  }) => {
    splitPanel.handle.close();
    openWithSplit(
      {
        type: 'component',
        id: 'folder-compose',
        params: {
          parentId: props.parentId,
          parentLabel: props.parentLabel ?? 'My Workspace',
          initialName: draft.name,
        },
      },
      { referredFrom: 'launcher', preferNewSplit: true }
    );
  };

  return (
    <CreateFolderComposer
      parentId={props.parentId}
      parentLabel={props.parentLabel ?? 'My Workspace'}
      onClose={handleClose}
      onSubmit={props.onSubmit}
      onContinueInSplit={
        splitPanel.handle.isPopover() ? handleContinueInSplit : undefined
      }
    />
  );
}
