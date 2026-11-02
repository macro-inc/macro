/** What a timeline's context menu offers for a record. */

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
