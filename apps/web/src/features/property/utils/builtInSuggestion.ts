import { SYSTEM_PROPERTY_IDS } from '../identifiers';

/** A built-in property that a new property's name duplicates. */
export type BuiltInPropertySuggestion = {
  propertyDefinitionId: string;
  /** The built-in property's name. */
  name: string;
  /** The CRM records it links to, as written mid-sentence. */
  records: string;
  /** One of those records. */
  record: string;
};

const CONTACTS: BuiltInPropertySuggestion = {
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.CONTACTS,
  name: 'Contacts',
  records: 'contacts',
  record: 'contact',
};

const COMPANIES: BuiltInPropertySuggestion = {
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.COMPANIES,
  name: 'Companies',
  records: 'companies',
  record: 'company',
};

// A Map, not an object: a property may be named `constructor`.
const SUGGESTIONS_BY_NAME = new Map<string, BuiltInPropertySuggestion>([
  ['contact', CONTACTS],
  ['contacts', CONTACTS],
  ['company', COMPANIES],
  ['companies', COMPANIES],
  ['customer', COMPANIES],
  ['customers', COMPANIES],
]);

/**
 * The built-in property a new property named `name` would duplicate. CRM lists
 * read the built-in Contacts and Companies properties, so a look-alike is worth
 * pointing out before it is created.
 */
export function builtInPropertySuggestion(
  name: string
): BuiltInPropertySuggestion | undefined {
  return SUGGESTIONS_BY_NAME.get(name.trim().toLowerCase());
}

/**
 * The built-in property that owns `name`. The server refuses a property that
 * reuses a built-in name, comparing the whole name without regard to case.
 */
export function builtInPropertyNamed<
  T extends { display_name: string; is_system: boolean },
>(name: string, definitions: readonly T[]): T | undefined {
  const typed = name.trim().toLowerCase();
  if (!typed) return undefined;
  return definitions.find(
    (definition) =>
      definition.is_system && definition.display_name.toLowerCase() === typed
  );
}
