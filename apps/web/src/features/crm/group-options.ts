import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { GroupOption } from '../next-soup/soup-view/group-options';
export const COMPANY_GROUP_OPTIONS: GroupOption[] = [
  { value: 'none', label: 'None' },
  { value: `property:${SYSTEM_PROPERTY_IDS.STAGE}`, label: 'Stage' },
  { value: `property:${SYSTEM_PROPERTY_IDS.COMPANY_OWNER}`, label: 'Owner' },
];
