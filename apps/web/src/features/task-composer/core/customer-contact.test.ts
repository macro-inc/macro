import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { describe, expect, it } from 'vitest';
import {
  customerContactSelection,
  customerContactValues,
} from './customer-contact';

const COMPANIES = SYSTEM_PROPERTY_IDS.COMPANIES;
const CONTACTS = SYSTEM_PROPERTY_IDS.CONTACTS;
const company = { entity_id: 'company-1', entity_type: 'COMPANY' as const };
const contact = { entity_id: 'contact-1', entity_type: 'CONTACT' as const };

describe('customerContactValues', () => {
  it('leaves the contact unset when a company is picked', () => {
    expect(customerContactValues(company, undefined)).toEqual({
      [COMPANIES]: { valueType: 'ENTITY', refs: [company] },
      [CONTACTS]: { valueType: 'ENTITY', refs: null },
    });
  });

  it('sets both when a contact is picked', () => {
    expect(customerContactValues(contact, 'company-1')).toEqual({
      [COMPANIES]: { valueType: 'ENTITY', refs: [company] },
      [CONTACTS]: { valueType: 'ENTITY', refs: [contact] },
    });
  });

  it('clears an earlier company when the picked contact has none', () => {
    expect(customerContactValues(contact, null)).toEqual({
      [COMPANIES]: { valueType: 'ENTITY', refs: null },
      [CONTACTS]: { valueType: 'ENTITY', refs: [contact] },
    });
  });

  it('clears both when the pick is removed', () => {
    expect(customerContactValues(undefined, undefined)).toEqual({
      [COMPANIES]: { valueType: 'ENTITY', refs: null },
      [CONTACTS]: { valueType: 'ENTITY', refs: null },
    });
  });
});

describe('customerContactSelection', () => {
  it('selects the contact when both are set', () => {
    expect(
      customerContactSelection({
        [COMPANIES]: { valueType: 'ENTITY', refs: [company] },
        [CONTACTS]: { valueType: 'ENTITY', refs: [contact] },
      })
    ).toEqual([contact]);
  });

  it('selects the company when no contact is set', () => {
    expect(
      customerContactSelection({
        [COMPANIES]: { valueType: 'ENTITY', refs: [company] },
        [CONTACTS]: { valueType: 'ENTITY', refs: null },
      })
    ).toEqual([company]);
  });
});
