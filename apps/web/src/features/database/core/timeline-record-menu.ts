/** What a timeline's context menu offers for a record. */
import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';

export type TimelineRecordAction =
  | 'open'
  | 'edit-range'
  | 'rename'
  | 'move'
  | 'add-dates'
  | 'remove-dates'
  | 'duplicate'
  | 'delete';

/**
 * A record's menu, in order. Viewers can only open it; editors change what
 * their columns allow: its dates, its title when it is plain text, and its
 * group when the timeline is grouped by a writable column.
 */
export function timelineRecordActions(params: {
  canEdit: boolean;
  dated: boolean;
  rangeWritable: boolean;
  titleWritable: boolean;
  groupWritable: boolean;
}): TimelineRecordAction[] {
  if (!params.canEdit) return ['open'];
  return [
    'open',
    ...(params.rangeWritable ? (['edit-range'] as const) : []),
    ...(params.titleWritable ? (['rename'] as const) : []),
    ...(params.groupWritable ? (['move'] as const) : []),
    ...(params.rangeWritable
      ? ([params.dated ? 'remove-dates' : 'add-dates'] as const)
      : []),
    'duplicate',
    'delete',
  ];
}

/** Keep action eligibility from the view while ordering its visible record menu. */
export function timelineRecordActionGroups(
  actions: readonly TimelineRecordAction[],
  hasMoveChoices: boolean
): TimelineRecordAction[][] {
  return groupMenuItems(
    actions.filter((action) => action !== 'move' || hasMoveChoices),
    (action): MenuGroup => {
      if (action === 'open') return 'open';
      if (action === 'delete') return 'delete';
      return 'modify';
    }
  ).map((section) => section.items);
}
