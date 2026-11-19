import { groupMenuItems, type MenuGroup } from '@core/menu/group-menu-items';

type FileMenuAction = { id?: string; orderKey?: string; group?: MenuGroup };

const MODIFY_ORDER: Record<string, number> = {
  rename: 0,
  appearance: 1,
  duplicate: 2,
  'move-to-folder': 3,
  'add-to-project': 4,
  'add-tag': 5,
};

const COPY_ORDER: Record<string, number> = { 'copy-link': 0, 'copy-id': 1 };

/** Compose the title, context, and drawer list without cloning live action getters. */
export function fileMenuGroups<T extends FileMenuAction>(
  tools: readonly T[],
  operations: readonly T[]
): Record<MenuGroup, T[]> {
  const groups: Record<MenuGroup, T[]> = {
    open: [],
    'most-used': [],
    copy: [],
    modify: [],
    'share-export': [],
    state: [],
    info: [],
    delete: [],
  };
  for (const section of groupMenuItems(
    [...tools, ...operations],
    (action) => action.group ?? 'modify'
  )) {
    groups[section.id] = section.items;
  }
  groups.copy.sort(
    (a, b) =>
      (COPY_ORDER[a.orderKey ?? a.id ?? ''] ?? 2) -
      (COPY_ORDER[b.orderKey ?? b.id ?? ''] ?? 2)
  );
  groups.modify.sort(
    (a, b) =>
      (MODIFY_ORDER[a.orderKey ?? a.id ?? ''] ?? 6) -
      (MODIFY_ORDER[b.orderKey ?? b.id ?? ''] ?? 6)
  );
  return groups;
}
