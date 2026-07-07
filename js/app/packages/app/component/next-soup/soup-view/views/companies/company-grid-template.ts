import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { DataType } from '@service-storage/generated/schemas/dataType';
import { EntityType } from '@service-storage/generated/schemas/entityType';

/**
 * Property columns for the Customers (CRM companies) list, mirroring
 * `task-grid-template.ts`. Each column maps to a builtin CRM system
 * property and is editable inline from the list.
 */
export const COMPANY_GRID_COLUMNS = [
  {
    id: 'stage',
    label: 'Stage',
    defId: SYSTEM_PROPERTY_IDS.STAGE,
    dataType: DataType.SELECT_STRING,
    isMultiSelect: false,
    specificEntityType: null,
    width: 'var(--company-col-stage, 8rem)',
  },
  {
    id: 'owner',
    label: 'Owner',
    defId: SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
    dataType: DataType.ENTITY,
    isMultiSelect: false,
    specificEntityType: EntityType.USER,
    width: 'var(--company-col-owner, 8rem)',
  },
  {
    id: 'revenue',
    label: 'Revenue',
    defId: SYSTEM_PROPERTY_IDS.REVENUE,
    dataType: DataType.NUMBER,
    isMultiSelect: false,
    specificEntityType: null,
    width: 'var(--company-col-revenue, 7rem)',
  },
] as const;

export type CompanyGridColumn = (typeof COMPANY_GRID_COLUMNS)[number];

/** Width for the trailing Last Interaction timestamp column. */
const LAST_INTERACTION_COLUMN_WIDTH = 'var(--company-col-timestamp, 7rem)';

export const COMPANY_GRID_TEMPLATE_COLUMNS = `1rem minmax(0, 100%) ${COMPANY_GRID_COLUMNS.map(
  (c) => c.width
).join(' ')} ${LAST_INTERACTION_COLUMN_WIDTH}`;

/** Template without the leading indicator (checkbox) column. */
export const COMPANY_GRID_TEMPLATE_COLUMNS_NO_INDICATOR = `minmax(0, 100%) ${COMPANY_GRID_COLUMNS.map(
  (c) => c.width
).join(' ')} ${LAST_INTERACTION_COLUMN_WIDTH}`;

export const COMPANY_GRID_TEMPLATE_AREAS = `"indicator content ${COMPANY_GRID_COLUMNS.map(
  (c) => c.id
).join(' ')} timestamp"`;

/** Template areas without the leading indicator (checkbox) column. */
export const COMPANY_GRID_TEMPLATE_AREAS_NO_INDICATOR = `"content ${COMPANY_GRID_COLUMNS.map(
  (c) => c.id
).join(' ')} timestamp"`;
