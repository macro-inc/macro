import { MENU_GROUP_ORDER, type MenuGroup } from '@core/menu/group-menu-items';

type Action = { id?: string; orderKey?: string; danger?: boolean };
type Groups<T> = Record<MenuGroup, T[]>;

/** Preserve action owners; only the phone sheet's order and grouping change. */
export function sessionActionGroups<T extends Action>(
  groups: Groups<T>,
  renameId?: string
): Groups<T> {
  const all = MENU_GROUP_ORDER.filter((group) => group !== 'delete').flatMap(
    (group) => groups[group]
  );
  const archive = all.find(
    (action) => action.id === 'archive' || action.orderKey === 'archive'
  );
  const priority = [renameId, 'copy-link', 'tool-1']
    .filter((id): id is string => id !== undefined)
    .flatMap((id) =>
      all.filter((action) => action.id === id || action.orderKey === id)
    );
  const remaining = all.filter(
    (action) => action !== archive && !priority.includes(action)
  );
  return {
    open: [],
    'most-used': [],
    copy: [],
    modify: [...priority, ...remaining],
    'share-export': [],
    state: [],
    info: [],
    delete: [
      ...(archive ? [archive] : []),
      ...groups.delete.map((action) => ({ ...action, danger: true })),
    ],
  };
}
