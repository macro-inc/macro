import { type Accessor, createSignal } from 'solid-js';

export type InlineRenameTarget = {
  id: string;
  name: string;
  isFolder: boolean;
  /** Which surface initiated the rename so only that instance mounts an input. */
  surface: 'sidebar' | 'list' | 'grid' | 'columns' | 'inspector';
};

export type InlineFolderCreateTarget = {
  parentId: string | null;
  surface: 'sidebar' | 'list' | 'grid' | 'columns';
};

export type DriveInlineEditState = {
  renaming: Accessor<InlineRenameTarget | undefined>;
  creatingFolder: Accessor<InlineFolderCreateTarget | undefined>;
  isEditing: Accessor<boolean>;
  isPending: Accessor<boolean>;
  startRename: (target: InlineRenameTarget) => void;
  cancelRename: () => void;
  startCreateFolder: (target: InlineFolderCreateTarget) => void;
  cancelCreateFolder: () => void;
  cancelAll: () => void;
  runCommit: <T>(operation: () => Promise<T>) => Promise<T | undefined>;
};

/**
 * Coordinates inline rename and inline folder creation across Drive surfaces
 * so at most one inline text field is active at a time.
 */
export function createDriveInlineEdit(): DriveInlineEditState {
  const [renaming, setRenaming] = createSignal<InlineRenameTarget>();
  const [creatingFolder, setCreatingFolder] =
    createSignal<InlineFolderCreateTarget>();
  const [isPending, setIsPending] = createSignal(false);

  const cancelAll = () => {
    setRenaming(undefined);
    setCreatingFolder(undefined);
  };

  return {
    renaming,
    creatingFolder,
    isEditing: () => Boolean(renaming() || creatingFolder()),
    isPending,

    startRename: (target) => {
      if (isPending()) return;
      setCreatingFolder(undefined);
      setRenaming(target);
    },

    cancelRename: () => {
      if (isPending()) return;
      setRenaming(undefined);
    },

    startCreateFolder: (target) => {
      if (isPending()) return;
      setRenaming(undefined);
      setCreatingFolder(target);
    },

    cancelCreateFolder: () => {
      if (isPending()) return;
      setCreatingFolder(undefined);
    },

    cancelAll,

    runCommit: async (operation) => {
      if (isPending()) return undefined;
      setIsPending(true);
      try {
        const result = await operation();
        cancelAll();
        return result;
      } finally {
        setIsPending(false);
      }
    },
  };
}
