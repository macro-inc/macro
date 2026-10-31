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

/** The task's project, shown only while Projects is enabled. */
export const TASK_PROJECT_COLUMN = {
  id: 'initiative',
  label: 'Project',
  defId: SYSTEM_PROPERTY_IDS.PROJECT,
  dataType: DataType.ENTITY,
  isMultiSelect: false,
  specificEntityType: EntityType.INITIATIVE,
  width: 'var(--task-col-initiative, 8rem)',
} as const;

/** Default creator width; each grid host controls its responsive visibility. */
const CREATED_BY_COLUMN_WIDTH = 'var(--task-col-created-by, 7rem)';

export type TaskGridColumn =
  | (typeof TASK_GRID_COLUMNS)[number]
  | typeof TASK_PROJECT_COLUMN;

/**
 * Shared column grid (includes Created By). The project column exists only
 * while Projects is enabled, so disabled lists keep their exact layout.
 */
export function taskGridTemplate(options: {
  indicator: boolean;
  project: boolean;
  /** Projects keep their status column; task rows edit status in the icon. */
  status?: boolean;
  /** Task rows edit priority beside status before the title. */
  priority?: boolean;
  /** Put task projects before assignees without reordering other grid hosts. */
  projectBeforeAssignees?: boolean;
  /** Keep the icon-only creator last without reordering other grid hosts. */
  createdByLast?: boolean;
}) {
  const propertyColumns: TaskGridColumn[] = TASK_GRID_COLUMNS.filter(
    (column) =>
      (options.status !== false || column.id !== 'status') &&
      (options.priority !== false || column.id !== 'priority')
  );
  if (options.project) {
    const projectIndex = options.projectBeforeAssignees
      ? propertyColumns.findIndex((column) => column.id === 'assignees')
      : propertyColumns.length;
    propertyColumns.splice(projectIndex, 0, TASK_PROJECT_COLUMN);
  }
  const metadataColumns = [
    { id: 'createdBy', width: CREATED_BY_COLUMN_WIDTH },
    { id: 'timestamp', width: 'var(--task-col-timestamp, 5rem)' },
  ];
  if (options.createdByLast) metadataColumns.reverse();
  const columns = [
    ...(options.indicator ? [{ id: 'indicator', width: '1rem' }] : []),
    { id: 'content', width: 'minmax(0, 100%)' },
    ...propertyColumns,
    ...metadataColumns,
  ];
  return {
    'grid-template-columns': columns.map((column) => column.width).join(' '),
    'grid-template-areas': `"${columns.map((column) => column.id).join(' ')}"`,
  };
}

/** Column span for full-width rows such as group headers. */
export const taskGridColumnCount = (
  project: boolean,
  status = true,
  priority = true
) => (project ? 6 : 5) + Number(status) + Number(priority);
