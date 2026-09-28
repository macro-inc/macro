import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { DataType } from '@service-storage/generated/schemas/dataType';
import { EntityType } from '@service-storage/generated/schemas/entityType';

export const TASK_GRID_COLUMNS = [
  {
    id: 'status',
    label: 'Status',
    defId: SYSTEM_PROPERTY_IDS.STATUS,
    dataType: DataType.SELECT_STRING,
    isMultiSelect: false,
    specificEntityType: null,
    sortKey: 'status',
    width: 'var(--task-col-status, 7rem)',
  },
  {
    id: 'priority',
    label: 'Priority',
    defId: SYSTEM_PROPERTY_IDS.PRIORITY,
    dataType: DataType.SELECT_STRING,
    isMultiSelect: false,
    specificEntityType: null,
    sortKey: 'priority',
    width: 'var(--task-col-priority, 7rem)',
  },
  {
    id: 'assignees',
    label: 'Assignees',
    defId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    dataType: DataType.ENTITY,
    isMultiSelect: true,
    specificEntityType: EntityType.USER,
    width: 'var(--task-col-assignees, 7rem)',
  },
] as const;

/** Width for the "Created By" column - only shown on wide containers */
const CREATED_BY_COLUMN_WIDTH = 'var(--task-col-created-by, 7rem)';

export type TaskGridColumn = (typeof TASK_GRID_COLUMNS)[number];

/**
 * Wide-container grid (includes Created By). The project column exists only
 * while Projects is enabled, so disabled lists keep their exact layout.
 */
export function taskGridTemplate(options: {
  indicator: boolean;
  project: boolean;
}) {
  const columns = [
    ...(options.indicator ? [{ id: 'indicator', width: '1rem' }] : []),
    { id: 'content', width: 'minmax(0, 100%)' },
    ...TASK_GRID_COLUMNS,
    ...(options.project
      ? [{ id: 'initiative', width: 'var(--task-col-initiative, 8rem)' }]
      : []),
    { id: 'createdBy', width: CREATED_BY_COLUMN_WIDTH },
    { id: 'timestamp', width: 'var(--task-col-timestamp, 5rem)' },
  ];
  return {
    'grid-template-columns': columns.map((column) => column.width).join(' '),
    'grid-template-areas': `"${columns.map((column) => column.id).join(' ')}"`,
  };
}

/** Column span for full-width rows such as group headers. */
export const taskGridColumnCount = (project: boolean) => (project ? 8 : 7);
