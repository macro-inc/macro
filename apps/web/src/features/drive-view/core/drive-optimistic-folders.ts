export type OptimisticFolderRecord = {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string | null;
};

export type OptimisticFolderOverlay<
  TFolder extends OptimisticFolderRecord = OptimisticFolderRecord,
> = {
  /** Optimistically created folders (temp or confirmed IDs not yet in server state). */
  created: ReadonlyMap<string, TFolder>;
  /** Pending folder parent overrides (`folderId -> newParentId`). */
  moved: ReadonlyMap<string, string | null>;
  /** Pending folder name overrides (`folderId -> newName`). */
  renamed: ReadonlyMap<string, string>;
  /** Folder IDs optimistically removed via Trash. */
  trashed: ReadonlySet<string>;
};

export const EMPTY_OPTIMISTIC_FOLDER_OVERLAY: OptimisticFolderOverlay<never> = {
  created: new Map<string, never>(),
  moved: new Map<string, string | null>(),
  renamed: new Map<string, string>(),
  trashed: new Set<string>(),
};

/**
 * Merges optimistic folder creates, moves, renames, and soft-deletes onto the
 * server folder list so the sidebar, breadcrumbs, and Drive views settle on
 * frame 0 without waiting for refetch round-trips.
 */
export function applyOptimisticFolders<TFolder extends OptimisticFolderRecord>(
  serverFolders: readonly TFolder[],
  overlay: OptimisticFolderOverlay<TFolder>
): TFolder[] {
  const hasAny =
    overlay.created.size > 0 ||
    overlay.moved.size > 0 ||
    overlay.renamed.size > 0 ||
    overlay.trashed.size > 0;
  if (!hasAny) return [...serverFolders];

  const seen = new Set<string>();
  const merged: TFolder[] = [];

  for (const folder of serverFolders) {
    if (overlay.trashed.has(folder.id)) continue;
    seen.add(folder.id);
    const movedParent = overlay.moved.has(folder.id)
      ? overlay.moved.get(folder.id)!
      : folder.parentId;
    const renamed = overlay.renamed.get(folder.id);
    if (movedParent !== folder.parentId || renamed !== undefined) {
      merged.push({
        ...folder,
        parentId: movedParent,
        name: renamed ?? folder.name,
      });
    } else {
      merged.push(folder);
    }
  }

  for (const folder of overlay.created.values()) {
    if (seen.has(folder.id) || overlay.trashed.has(folder.id)) continue;
    const movedParent = overlay.moved.has(folder.id)
      ? overlay.moved.get(folder.id)!
      : folder.parentId;
    const renamed = overlay.renamed.get(folder.id);
    merged.push(
      movedParent !== folder.parentId || renamed !== undefined
        ? { ...folder, parentId: movedParent, name: renamed ?? folder.name }
        : folder
    );
  }

  return merged;
}

/**
 * Drops optimistic entries that the authoritative server folder list already
 * reflects so stale overrides never outlive a subsequent refetch.
 */
export function reconcileOptimisticFolders<
  TFolder extends OptimisticFolderRecord,
>(
  serverFolders: readonly TFolder[],
  overlay: OptimisticFolderOverlay<TFolder>
): OptimisticFolderOverlay<TFolder> {
  if (
    overlay.created.size === 0 &&
    overlay.moved.size === 0 &&
    overlay.renamed.size === 0 &&
    overlay.trashed.size === 0
  ) {
    return overlay;
  }

  const byId = new Map(serverFolders.map((folder) => [folder.id, folder]));
  let changed = false;

  const created = new Map(overlay.created);
  for (const id of created.keys()) {
    if (byId.has(id)) {
      created.delete(id);
      changed = true;
    }
  }

  const moved = new Map(overlay.moved);
  for (const [id, targetParent] of moved) {
    const server = byId.get(id);
    if (server && server.parentId === targetParent) {
      moved.delete(id);
      changed = true;
    }
  }

  const renamed = new Map(overlay.renamed);
  for (const [id, targetName] of renamed) {
    const server = byId.get(id);
    if (server && server.name === targetName) {
      renamed.delete(id);
      changed = true;
    }
  }

  const trashed = new Set(overlay.trashed);
  for (const id of trashed) {
    if (!byId.has(id)) {
      trashed.delete(id);
      changed = true;
    }
  }

  return changed ? { created, moved, renamed, trashed } : overlay;
}
