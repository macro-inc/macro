import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { PropertyApiValues } from '@property/types';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';

/** The properties the Customer / Contact pill writes, replacing their own pills. */
export const CUSTOMER_CONTACT_PROPERTY_IDS: readonly string[] = [
  SYSTEM_PROPERTY_IDS.COMPANIES,
  SYSTEM_PROPERTY_IDS.CONTACTS,
];

function entityReferences(value: PropertyApiValues | undefined) {
  return value?.valueType === 'ENTITY' ? (value.refs ?? []) : [];
}

/** The company and contact held by a composer's property values. */
export function customerContactReferences(
  values: Record<string, PropertyApiValues>
): EntityReference[] {
  return [
    ...entityReferences(values[SYSTEM_PROPERTY_IDS.COMPANIES]),
    ...entityReferences(values[SYSTEM_PROPERTY_IDS.CONTACTS]),
  ];
}

/** The one reference the pill selects: the contact when there is one. */
export function customerContactSelection(
  values: Record<string, PropertyApiValues>
): EntityReference[] {
  const contacts = entityReferences(values[SYSTEM_PROPERTY_IDS.CONTACTS]);
  return contacts.length > 0
    ? contacts
    : entityReferences(values[SYSTEM_PROPERTY_IDS.COMPANIES]);
}

/**
 * Both property values for a pick. A company leaves the contact unset, and a
 * contact also sets the company it belongs to.
 */
export function customerContactValues(
  picked: EntityReference | undefined,
  contactCompanyId: string | null | undefined
): Record<string, PropertyApiValues> {
  const contact = picked?.entity_type === 'CONTACT' ? picked : undefined;
  const contactCompany: EntityReference | undefined = contactCompanyId
    ? { entity_id: contactCompanyId, entity_type: 'COMPANY' }
    : undefined;
  const company = contact ? contactCompany : picked;

  return {
    [SYSTEM_PROPERTY_IDS.COMPANIES]: {
      valueType: 'ENTITY',
      refs: company ? [company] : null,
    },
    [SYSTEM_PROPERTY_IDS.CONTACTS]: {
      valueType: 'ENTITY',
      refs: contact ? [contact] : null,
    },
  };
}
