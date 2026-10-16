import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PropertyApiValues } from '@property/types';
import type { TaskComposerContext } from '../task-composer/core/context';
import type { CrmTaskRecord } from './core/record';

const reference = (
  entityId: string,
  entityType: 'COMPANY' | 'CONTACT'
): PropertyApiValues => ({
  valueType: 'ENTITY',
  refs: [{ entity_id: entityId, entity_type: entityType }],
});

/** CRM owns its composer preset; the shared composer has no CRM-specific behavior. */
export function crmTaskComposerContext(
  record?: CrmTaskRecord
): TaskComposerContext {
  const initialPropertyValues: Record<string, PropertyApiValues> = {};
  if (record?.type === 'company') {
    initialPropertyValues[SYSTEM_PROPERTY_IDS.COMPANIES] = reference(
      record.id,
      'COMPANY'
    );
  } else if (record?.type === 'contact') {
    initialPropertyValues[SYSTEM_PROPERTY_IDS.CONTACTS] = reference(
      record.id,
      'CONTACT'
    );
    if (record.companyId) {
      initialPropertyValues[SYSTEM_PROPERTY_IDS.COMPANIES] = reference(
        record.companyId,
        'COMPANY'
      );
    }
  }
  return {
    key: record ? `crm:${record.type}:${record.id}` : 'crm',
    visiblePropertyIds: [
      SYSTEM_PROPERTY_IDS.COMPANIES,
      SYSTEM_PROPERTY_IDS.CONTACTS,
      SYSTEM_PROPERTY_IDS.ASSIGNEES,
      SYSTEM_PROPERTY_IDS.DUE_DATE,
      SYSTEM_PROPERTY_IDS.PRIORITY,
    ],
    initialPropertyValues,
  };
}
