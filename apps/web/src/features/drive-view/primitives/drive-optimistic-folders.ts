import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import type { DriveFolderMetadata } from '../context/drive-source';
import {
  applyOptimisticFolders,
  EMPTY_OPTIMISTIC_FOLDER_OVERLAY,
  type OptimisticFolderOverlay,
  reconcileOptimisticFolders,
} from '../core/drive-optimistic-folders';

export type DriveOptimisticFoldersController = {
  folders: Accessor<DriveFolderMetadata[]>;
  beginCreate: (folder: DriveFolderMetadata) => void;
  confirmCreate: (tempId: string, realId: string) => void;
  rollbackCreate: (id: string) => void;
  beginMove: (folderIds: readonly string[], parentId: string | null) => void;
  rollbackMove: (folderIds: readonly string[]) => void;
  beginRename: (folderId: string, nextName: string) => void;
  rollbackRename: (folderId: string) => void;
  beginTrash: (folderIds: readonly string[]) => void;
  rollbackTrash: (folderIds: readonly string[]) => void;
  clear: () => void;
};

/**
 * Local optimistic folder overlay so folder creation, reparenting, rename, and
 * Trash settle immediately in the sidebar, breadcrumbs, and Drive views, then
 * reconcile cleanly when the authoritative GraphQL folders query catches up.
 */
export function createOptimisticFoldersController(
  serverFolders: Accessor<DriveFolderMetadata[]>
): DriveOptimisticFoldersController {
  const [overlay, setOverlay] = createSignal<
    OptimisticFolderOverlay<DriveFolderMetadata>
  >(EMPTY_OPTIMISTIC_FOLDER_OVERLAY);

  createEffect(() => {
    const server = serverFolders();
    setOverlay((current) => reconcileOptimisticFolders(server, current));
  });

  const folders = createMemo(() =>
    applyOptimisticFolders(serverFolders(), overlay())
  );

  return {
    folders,

    beginCreate: (folder) => {
      setOverlay((current) => {
        const created = new Map(current.created);
        created.set(folder.id, folder);
        return { ...current, created };
      });
    },

    confirmCreate: (tempId, realId) => {
      setOverlay((current) => {
        const existing = current.created.get(tempId);
        if (!existing) return current;
        const created = new Map(current.created);
        created.delete(tempId);
        // Keep under realId until the GraphQL folder query delivers it.
        if (!serverFolders().some((folder) => folder.id === realId)) {
          created.set(realId, { ...existing, id: realId });
        }
        return { ...current, created };
      });
    },

    rollbackCreate: (id) => {
      setOverlay((current) => {
        if (!current.created.has(id)) return current;
        const created = new Map(current.created);
        created.delete(id);
        return { ...current, created };
      });
    },

    beginMove: (folderIds, parentId) => {
      if (folderIds.length === 0) return;
      setOverlay((current) => {
        const moved = new Map(current.moved);
        for (const id of folderIds) moved.set(id, parentId);
        return { ...current, moved };
      });
    },

    rollbackMove: (folderIds) => {
      if (folderIds.length === 0) return;
      setOverlay((current) => {
        const moved = new Map(current.moved);
        let changed = false;
        for (const id of folderIds) {
          if (moved.delete(id)) changed = true;
        }
        return changed ? { ...current, moved } : current;
      });
    },

    beginRename: (folderId, nextName) => {
      setOverlay((current) => {
        const renamed = new Map(current.renamed);
        renamed.set(folderId, nextName);
        return { ...current, renamed };
      });
    },

    rollbackRename: (folderId) => {
      setOverlay((current) => {
        if (!current.renamed.has(folderId)) return current;
        const renamed = new Map(current.renamed);
        renamed.delete(folderId);
        return { ...current, renamed };
      });
    },

    beginTrash: (folderIds) => {
      if (folderIds.length === 0) return;
      setOverlay((current) => {
        const trashed = new Set(current.trashed);
        for (const id of folderIds) trashed.add(id);
        return { ...current, trashed };
      });
    },

    rollbackTrash: (folderIds) => {
      if (folderIds.length === 0) return;
      setOverlay((current) => {
        const trashed = new Set(current.trashed);
        let changed = false;
        for (const id of folderIds) {
          if (trashed.delete(id)) changed = true;
        }
        return changed ? { ...current, trashed } : current;
      });
    },

    clear: () => setOverlay(EMPTY_OPTIMISTIC_FOLDER_OVERLAY),
  };
}
