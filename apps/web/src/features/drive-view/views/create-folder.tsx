import {
  handleFileFolderDrop,
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import { InlineTagsPill, useLocalDocTags } from '@property/tags';
import { createSignal, onMount, Suspense } from 'solid-js';
import { FolderComposer } from '../components/folder-composer';
import type {
  FolderCreationCommands,
  FolderDraft,
  FolderSubmission,
} from '../core/folder-composer';
import { createFolderComposer } from '../primitives/folder-composer';

export function CreateFolder(props: {
  commands: FolderCreationCommands;
  destination: string;
  initialDraft?: FolderDraft;
  onClose(): void;
  onSubmit(submission: FolderSubmission): void;
  onExpand?(draft: FolderDraft): void;
}) {
  const composer = createFolderComposer(props.commands, props.initialDraft);
  const [preparing, setPreparing] = createSignal(false);
  const [preparationError, setPreparationError] = createSignal<string>();
  const busy = () => composer.pending() || preparing();
  const tags = useLocalDocTags(
    (id) => composer.tags()[id] ?? [],
    (definition, ids) => {
      composer.setTags((current) => ({ ...current, [definition.id]: ids }));
    }
  );
  let form: HTMLDivElement | undefined;
  onMount(() => form?.querySelector<HTMLInputElement>('input')?.focus());

  const prepare = async (action: () => Promise<void>) => {
    if (busy()) return;
    setPreparing(true);
    setPreparationError(undefined);
    try {
      await action();
    } catch {
      setPreparationError(
        'Could not prepare the files. Please select them again.'
      );
    } finally {
      setPreparing(false);
    }
  };
  const submit = () => {
    if (busy()) return;
    const submission = composer.submit();
    if (submission) props.onSubmit(submission);
  };

  return (
    <div ref={form} class="h-full min-h-0">
      <FolderComposer
        name={composer.name()}
        destination={props.destination}
        files={composer.files()}
        tags={
          <Suspense
            fallback={<span class="text-xs text-ink-muted">Loading tags…</span>}
          >
            <InlineTagsPill docTags={tags} showAddButton />
          </Suspense>
        }
        busy={busy()}
        preparing={preparing()}
        created={!!composer.createdId()}
        error={preparationError() ?? composer.error()}
        onName={composer.setName}
        onRemove={composer.removeFile}
        onClear={() => {
          composer.clear();
          setPreparationError(undefined);
        }}
        onClose={props.onClose}
        onExpand={
          props.onExpand
            ? () => props.onExpand?.(composer.snapshot())
            : undefined
        }
        onSubmit={submit}
        onFiles={() => {
          openFilePicker({ multiple: true }, (files) => {
            if (!busy())
              composer.addFiles(
                files.map((file) => ({ file, isFolder: false }))
              );
          });
        }}
        onFolder={() => {
          openFolderPicker({}, (files) =>
            prepare(() => handleFolderSelect(files, composer.addFiles))
          );
        }}
        onDrop={(files, folders) => {
          void prepare(() =>
            handleFileFolderDrop(files, folders, composer.addFiles)
          );
        }}
      />
    </div>
  );
}
