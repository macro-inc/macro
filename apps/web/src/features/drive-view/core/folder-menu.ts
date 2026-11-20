import {
  groupMenuItems,
  type MenuGroup,
  type MenuSection,
} from '../../../lib/core/menu/group-menu-items';

const FOLDER_ACTION_ORDER = [
  'share',
  'favorite',
  'copy-link',
  'copy-id',
  'rename',
  'duplicate',
  'move',
  'mute',
  'delete',
] as const;

export type FolderMenuAction = (typeof FOLDER_ACTION_ORDER)[number];

/** Order available sidebar folder actions without changing their descriptors. */
export function folderMenuGroups<
  T extends { id: FolderMenuAction; group: MenuGroup },
>(items: readonly T[]): MenuSection<T>[] {
  return groupMenuItems(
    [...items].sort(
      (a, b) =>
        FOLDER_ACTION_ORDER.indexOf(a.id) - FOLDER_ACTION_ORDER.indexOf(b.id)
    ),
    (item) => item.group
  );
}
