import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';

export type DatabaseRecordMenuAction =
  | 'open'
  | 'edit-cell'
  | 'rename'
  | 'duplicate'
  | 'delete';

/** A record's available actions in one order for its context menu. */
export function databaseRecordMenuGroups(availability: {
  editCell: boolean;
  saved: boolean;
  rename: boolean;
  duplicate: boolean;
  delete: boolean;
}): DatabaseRecordMenuAction[][] {
  const actions: DatabaseRecordMenuAction[] = [
    ...(availability.saved ? (['open'] as const) : []),
    ...(availability.editCell ? (['edit-cell'] as const) : []),
    ...(availability.saved && availability.rename ? (['rename'] as const) : []),
    ...(availability.saved && availability.duplicate
      ? (['duplicate'] as const)
      : []),
    ...(availability.saved && availability.delete ? (['delete'] as const) : []),
  ];
  return groupMenuItems(actions, (action): MenuGroup => {
    if (action === 'open') return 'open';
    if (action === 'delete') return 'delete';
    return 'modify';
  }).map((section) => section.items);
}
