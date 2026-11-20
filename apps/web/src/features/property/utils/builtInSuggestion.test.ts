import { expect, it } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import { builtInPropertySuggestion } from './builtInSuggestion';

it('suggests the built-in property a look-alike name duplicates', () => {
  expect(builtInPropertySuggestion('Contact')?.propertyDefinitionId).toBe(
    SYSTEM_PROPERTY_IDS.CONTACTS
  );
  expect(builtInPropertySuggestion('  CONTACTS ')?.propertyDefinitionId).toBe(
    SYSTEM_PROPERTY_IDS.CONTACTS
  );
  expect(builtInPropertySuggestion('company')?.propertyDefinitionId).toBe(
    SYSTEM_PROPERTY_IDS.COMPANIES
  );
  // A customer is a company in the CRM.
  expect(builtInPropertySuggestion('Customer')?.propertyDefinitionId).toBe(
    SYSTEM_PROPERTY_IDS.COMPANIES
  );
});

it('leaves other names alone', () => {
  expect(builtInPropertySuggestion('')).toBeUndefined();
  expect(builtInPropertySuggestion('Contact owner')).toBeUndefined();
  expect(builtInPropertySuggestion('Customer tier')).toBeUndefined();
  // Not a key of the lookup: an object's own machinery must not match.
  expect(builtInPropertySuggestion('constructor')).toBeUndefined();
});
