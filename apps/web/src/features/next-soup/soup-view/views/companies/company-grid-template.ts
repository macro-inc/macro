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

/**
 * `grid-template-columns` for the given visible property columns (hidden
 * columns collapse entirely). `hideIndicator` drops the leading
 * indicator (checkbox) track.
 */
export function companyGridTemplateColumns(
  visible: readonly CompanyGridColumn[],
  hideIndicator: boolean
): string {
  return [
    ...(hideIndicator ? [] : ['1rem']),
    'minmax(0, 100%)',
    ...visible.map((c) => c.width),
    LAST_INTERACTION_COLUMN_WIDTH,
  ].join(' ');
}

/** `grid-template-areas` counterpart of {@link companyGridTemplateColumns}. */
export function companyGridTemplateAreas(
  visible: readonly CompanyGridColumn[],
  hideIndicator: boolean
): string {
  const areas = [
    ...(hideIndicator ? [] : ['indicator']),
    'content',
    ...visible.map((c) => c.id),
    'timestamp',
  ].join(' ');
  return `"${areas}"`;
}

export const COMPANY_GRID_TEMPLATE_COLUMNS = companyGridTemplateColumns(
  COMPANY_GRID_COLUMNS,
  false
);

/** Template without the leading indicator (checkbox) column. */
export const COMPANY_GRID_TEMPLATE_COLUMNS_NO_INDICATOR =
  companyGridTemplateColumns(COMPANY_GRID_COLUMNS, true);

export const COMPANY_GRID_TEMPLATE_AREAS = companyGridTemplateAreas(
  COMPANY_GRID_COLUMNS,
  false
);

/** Template areas without the leading indicator (checkbox) column. */
export const COMPANY_GRID_TEMPLATE_AREAS_NO_INDICATOR =
  companyGridTemplateAreas(COMPANY_GRID_COLUMNS, true);
