import { expect, it } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import {
  builtInPropertyNamed,
  builtInPropertySuggestion,
} from './builtInSuggestion';

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

it('finds the built-in property that owns a name, whatever its case', () => {
  const definitions = [
    { id: 'contacts', display_name: 'Contacts', is_system: true },
    { id: 'due', display_name: 'Due Date', is_system: true },
    { id: 'mine', display_name: 'Region', is_system: false },
  ];

  expect(builtInPropertyNamed('contacts', definitions)?.id).toBe('contacts');
  expect(builtInPropertyNamed('  DUE DATE ', definitions)?.id).toBe('due');
  // The whole name has to match, and only built-in properties reserve one.
  expect(builtInPropertyNamed('Contact', definitions)).toBeUndefined();
  expect(builtInPropertyNamed('Region', definitions)).toBeUndefined();
  expect(builtInPropertyNamed('', definitions)).toBeUndefined();
});
