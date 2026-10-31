import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { DataType } from '@service-storage/generated/schemas/dataType';
import { EntityType } from '@service-storage/generated/schemas/entityType';

export type TaskGridColumnId =
  | 'indicator'
  | 'content'
  | 'status'
  | 'priority'
  | 'initiative'
  | 'assignees'
  | 'createdBy'
  | 'timestamp';

const COLUMN_WIDTHS: Record<TaskGridColumnId, string> = {
  indicator: '1rem',
  content: 'minmax(0, 100%)',
  status: 'var(--task-col-status, 7rem)',
  priority: 'var(--task-col-priority, 7rem)',
  initiative: 'var(--task-col-initiative, 8rem)',
  assignees: 'var(--task-col-assignees, 7rem)',
  createdBy: 'var(--task-col-created-by, 7rem)',
  timestamp: 'var(--task-col-timestamp, 5rem)',
};

export const TASK_GRID_COLUMNS = [
  {
    id: 'status',
    label: 'Status',
    defId: SYSTEM_PROPERTY_IDS.STATUS,
    dataType: DataType.SELECT_STRING,
    isMultiSelect: false,
    specificEntityType: null,
    sortKey: 'status',
    width: COLUMN_WIDTHS.status,
  },
  {
    id: 'priority',
    label: 'Priority',
    defId: SYSTEM_PROPERTY_IDS.PRIORITY,
    dataType: DataType.SELECT_STRING,
    isMultiSelect: false,
    specificEntityType: null,
    sortKey: 'priority',
    width: COLUMN_WIDTHS.priority,
  },
  {
    id: 'assignees',
    label: 'Assignees',
    defId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    dataType: DataType.ENTITY,
    isMultiSelect: true,
    specificEntityType: EntityType.USER,
    width: COLUMN_WIDTHS.assignees,
  },
] as const;

/** The task's project, shown only while Projects is enabled. */
export const TASK_PROJECT_COLUMN = {
  id: 'initiative',
  label: 'Project',
  defId: SYSTEM_PROPERTY_IDS.PROJECT,
  dataType: DataType.ENTITY,
  isMultiSelect: false,
  specificEntityType: EntityType.INITIATIVE,
  width: COLUMN_WIDTHS.initiative,
} as const;

export type TaskGridColumn =
  | (typeof TASK_GRID_COLUMNS)[number]
  | typeof TASK_PROJECT_COLUMN;

/** Default grid order always places Project before Assignees. */
export const DEFAULT_TASK_GRID_COLUMNS = [
  'indicator',
  'content',
  'status',
  'priority',
  'initiative',
  'assignees',
  'createdBy',
  'timestamp',
] as const satisfies readonly TaskGridColumnId[];

/** Task rows edit Status and Priority beside the title and show the creator last. */
export const TASK_LIST_COLUMNS = [
  'indicator',
  'content',
  'initiative',
  'assignees',
  'timestamp',
  'createdBy',
] as const satisfies readonly TaskGridColumnId[];

export function taskGridTemplate(
  columns: readonly TaskGridColumnId[] = DEFAULT_TASK_GRID_COLUMNS
) {
  return {
    'grid-template-columns': columns.map((id) => COLUMN_WIDTHS[id]).join(' '),
    'grid-template-areas': `"${columns.join(' ')}"`,
  };
}
