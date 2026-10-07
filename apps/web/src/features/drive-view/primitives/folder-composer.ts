import { createSignal } from 'solid-js';
import type {
  FolderCreationCommands,
  FolderDraft,
  FolderSubmission,
  FolderUpload,
} from '../core/folder-composer';

/** Finish a detached draft without reading or updating the disposed composer. */
async function finishFolder(
  commands: FolderCreationCommands,
  draft: FolderDraft
): FolderSubmission['result'] {
  let id = draft.createdId;
  try {
    id ??= await commands.create(draft.name);
  } catch {
    return {
      type: 'failed',
      draft: {
        ...draft,
        error: 'Could not create the folder. Please try again.',
      },
    };
  }
  let tagsFailed = false;
  try {
    await commands.saveTags(id, draft.tags);
  } catch {
    tagsFailed = true;
  }
  const results = await Promise.allSettled(
    draft.files.map((file) => commands.upload(id, file))
  );
  const failedFiles = draft.files.filter(
    (_, index) => results[index].status === 'rejected'
  );
  if (tagsFailed || failedFiles.length) {
    return {
      type: 'failed',
      draft: {
        ...draft,
        createdId: id,
        files: failedFiles,
        error:
          'Folder created, but some items could not be saved. Retry to finish adding your tags and files.',
      },
    };
  }
  return { type: 'created', id, name: draft.name };
}

export function createFolderComposer(
  commands: FolderCreationCommands,
  initial?: FolderDraft
) {
  const [name, setName] = createSignal(initial?.name ?? '');
  const [tags, setTags] = createSignal(initial?.tags ?? {});
  const [files, setFiles] = createSignal<FolderUpload[]>(initial?.files ?? []);
  const createdId = () => initial?.createdId;
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal(initial?.error);
  const snapshot = (): FolderDraft => ({
    name: name(),
    tags: Object.fromEntries(
      Object.entries(tags()).map(([id, ids]) => [id, [...ids]])
    ),
    files: [...files()],
    createdId: createdId(),
    error: error(),
  });

  const submit = (): FolderSubmission | undefined => {
    if (pending() || !name().trim()) return;
    setPending(true);
    const draft = { ...snapshot(), name: name().trim(), error: undefined };
    return { result: finishFolder(commands, draft) };
  };

  return {
    name,
    setName,
    tags,
    setTags,
    files,
    createdId,
    pending,
    error,
    snapshot,
    submit,
    addFiles: (entries: FolderUpload[]) => {
      setFiles((current) => [...current, ...entries]);
    },
    removeFile: (entry: FolderUpload) =>
      setFiles((current) => current.filter((file) => file !== entry)),
    clear() {
      if (pending() || createdId()) return;
      setName('');
      setTags({});
      setFiles([]);
      setError(undefined);
    },
  };
}
