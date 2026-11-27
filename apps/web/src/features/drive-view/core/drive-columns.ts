import { folderAncestors } from './folder-tree';
import type { DriveFolder } from './types';

/**
 * Builds the sequence of folder IDs shown left-to-right in Finder Miller
 * Columns view: always starts with `null` (My Drive root), followed by each
 * ancestor down to `activeFolderId`.
 */
export function buildMillerColumnPath(
  folders: readonly DriveFolder[],
  activeFolderId: string | null
): (string | null)[] {
  if (!activeFolderId) return [null];
  const ancestors = folderAncestors(folders, activeFolderId);
  if (ancestors.length === 0) return [null];
  return [null, ...ancestors.map((folder) => folder.id)];
}

export type CollapsedBreadcrumbs<T> = {
  leading: T[];
  hidden: T[];
  trailing: T[];
};

/**
 * Collapses long breadcrumb trails while always keeping the root segment and
 * the most recent trailing segments visible. Middle segments move into
 * `hidden` for an interactive `…` overflow menu.
 */
export function collapseBreadcrumbs<T>(
  entries: readonly T[],
  maxVisible = 4
): CollapsedBreadcrumbs<T> {
  const limit = Math.max(2, maxVisible);
  if (entries.length <= limit) {
    return { leading: [...entries], hidden: [], trailing: [] };
  }

  const trailingCount = limit - 1;
  return {
    leading: entries.slice(0, 1),
    hidden: entries.slice(1, entries.length - trailingCount),
    trailing: entries.slice(entries.length - trailingCount),
  };
}
