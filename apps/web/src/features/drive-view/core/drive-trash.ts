export type DriveTrashItemType = 'document' | 'project' | 'chat';

export type DriveTrashItem = {
  id: string;
  itemType: DriveTrashItemType;
  name: string;
  fileType?: string;
  subType?: string;
  deletedAt: string | null;
  updatedAt: string | null;
  parentFolderId: string | null;
  ownerId: string;
};

/**
 * Filters trashed items by a search term against their name or file type.
 */
export function filterTrashItems(
  items: readonly DriveTrashItem[],
  search: string
): DriveTrashItem[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return [...items];

  return items.filter(
    (item) =>
      item.name.toLocaleLowerCase().includes(term) ||
      (item.fileType?.toLocaleLowerCase().includes(term) ?? false)
  );
}

/**
 * Deduplicates top-level trashed entries when a whole folder tree was trashed
 * together: if an item's parent folder is also in the trashed list, the child
 * is still accessible if restored via its folder, while standalone trashed
 * items remain visible directly. Returns both top-level items and child counts
 * nested under each trashed folder.
 */
export function summarizeTrashHierarchy(items: readonly DriveTrashItem[]): {
  topLevel: DriveTrashItem[];
  nestedCountByFolderId: ReadonlyMap<string, number>;
} {
  const trashedFolderIds = new Set(
    items.filter((item) => item.itemType === 'project').map((item) => item.id)
  );
  const nestedCountByFolderId = new Map<string, number>();
  const topLevel: DriveTrashItem[] = [];

  for (const item of items) {
    if (item.parentFolderId && trashedFolderIds.has(item.parentFolderId)) {
      nestedCountByFolderId.set(
        item.parentFolderId,
        (nestedCountByFolderId.get(item.parentFolderId) ?? 0) + 1
      );
      continue;
    }
    topLevel.push(item);
  }

  return { topLevel, nestedCountByFolderId };
}
