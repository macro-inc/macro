import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
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
    width: 'minmax(9rem, 9rem)',
  },
  {
    id: 'priority',
    label: 'Priority',
    defId: SYSTEM_PROPERTY_IDS.PRIORITY,
    dataType: DataType.SELECT_STRING,
    isMultiSelect: false,
    specificEntityType: null,
    width: 'minmax(9rem, 9rem)',
  },
  {
    id: 'assignees',
    label: 'Assignees',
    defId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
    dataType: DataType.ENTITY,
    isMultiSelect: true,
    specificEntityType: EntityType.USER,
    width: 'minmax(9rem, 9rem)',
  },
] as const;

export type TaskGridColumn = (typeof TASK_GRID_COLUMNS)[number];

export const TASK_GRID_TEMPLATE_COLUMNS = `1rem minmax(0, 100%) ${TASK_GRID_COLUMNS.map(
  (c) => c.width
).join(' ')} 5rem`;

export const TASK_GRID_TEMPLATE_AREAS = `"indicator content ${TASK_GRID_COLUMNS.map(
  (c) => c.id
).join(' ')} timestamp"`;
