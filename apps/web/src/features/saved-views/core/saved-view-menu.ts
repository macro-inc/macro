import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';

export type SavedViewMenuItem =
  | 'copy-link'
  | 'edit'
  | 'appearance'
  | 'duplicate'
  | 'move-up'
  | 'move-down'
  | 'delete';

/** Filter actions before grouping so every host uses the same order. */
export function savedViewMenuGroups(options: {
  owned: boolean;
  copyLink: boolean;
  appearance: boolean;
  moveUp: boolean;
  moveDown: boolean;
}): SavedViewMenuItem[][] {
  const items: SavedViewMenuItem[] = [
    ...(options.copyLink ? (['copy-link'] as const) : []),
    ...(options.owned ? (['edit'] as const) : []),
    ...(options.appearance ? (['appearance'] as const) : []),
    'duplicate',
    ...(options.moveUp ? (['move-up'] as const) : []),
    ...(options.moveDown ? (['move-down'] as const) : []),
    ...(options.owned ? (['delete'] as const) : []),
  ];
  return groupMenuItems(items, (item): MenuGroup => {
    if (item === 'copy-link') return 'copy';
    if (item === 'delete') return 'delete';
    return 'modify';
  }).map((group) => group.items);
}
