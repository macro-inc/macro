import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { ExportColumn } from '../core/export';
export const COMPANY_EXPORT_COLUMNS: ExportColumn[] = [
  { id: 'name', label: 'Company', default: true },
  { id: 'domains', label: 'Domains', default: true },
  { id: 'stage', label: 'Stage', default: true },
  { id: 'owner', label: 'Owner', default: true },
  {
    id: `property:${SYSTEM_PROPERTY_IDS.REVENUE}`,
    label: 'Revenue',
    default: true,
  },
  { id: 'lastInteraction', label: 'Last interaction', default: true },
  { id: 'firstInteraction', label: 'First interaction' },
  { id: 'description', label: 'Description' },
  { id: 'emailSync', label: 'Email sync' },
  { id: 'id', label: 'Company ID' },
];
