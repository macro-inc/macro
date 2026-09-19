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

/** Grid template for wide containers (includes Created By column) */
export const TASK_GRID_TEMPLATE_COLUMNS_WIDE = `1rem minmax(0, 100%) ${TASK_GRID_COLUMNS.map(
  (c) => c.width
).join(' ')} ${CREATED_BY_COLUMN_WIDTH} var(--task-col-timestamp, 5rem)`;

/** Wide template without the leading indicator (checkbox) column. */
export const TASK_GRID_TEMPLATE_COLUMNS_WIDE_NO_INDICATOR = `minmax(0, 100%) ${TASK_GRID_COLUMNS.map(
  (c) => c.width
).join(' ')} ${CREATED_BY_COLUMN_WIDTH} var(--task-col-timestamp, 5rem)`;

/** Grid template areas for wide containers (includes Created By column) */
export const TASK_GRID_TEMPLATE_AREAS_WIDE = `"indicator content ${TASK_GRID_COLUMNS.map(
  (c) => c.id
).join(' ')} createdBy timestamp"`;

/** Wide template areas without the leading indicator (checkbox) column. */
export const TASK_GRID_TEMPLATE_AREAS_WIDE_NO_INDICATOR = `"content ${TASK_GRID_COLUMNS.map(
  (c) => c.id
).join(' ')} createdBy timestamp"`;
