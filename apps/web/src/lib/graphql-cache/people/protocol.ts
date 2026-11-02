import {
  MAX_PEOPLE_BATCH,
  MAX_PEOPLE_QUERY_BYTES,
  type PeopleContextState,
  PeopleContextStateSchema,
  type PeopleContextUpdate,
  PeopleContextUpdateSchema,
  type PeopleScope,
  PeopleScopeSchema,
  type PeopleSearch,
  type PeopleSearchResult,
  PeopleSearchResultSchema,
  PeopleSearchSchema,
} from './generated';

export type {
  PeopleContextState,
  PeopleContextUpdate,
  PeopleScope,
  PeopleSearch,
  PeopleSearchResult,
} from './generated';

export const PEOPLE_UNSUPPORTED = 'Contact search context is unsupported';
const UTF8 = new TextEncoder();

/** Bound arrays before schema traversal; never return validation input in errors. */
export function isPeopleSearch(value: unknown): value is PeopleSearch {
  if (
    !value ||
    typeof value !== 'object' ||
    !('excluded' in value) ||
    !Array.isArray(value.excluded) ||
    value.excluded.length > MAX_PEOPLE_BATCH
  )
    return false;
  const result = PeopleSearchSchema.safeParse(value);
  return (
    result.success &&
    isPeopleScope(result.data.scope) &&
    UTF8.encode(result.data.query).length <= MAX_PEOPLE_QUERY_BYTES &&
    result.data.excluded.every((id) => UTF8.encode(id).length <= 1024) &&
    (result.data.senderDomain == null ||
      UTF8.encode(result.data.senderDomain).length <= 255) &&
    Number.isSafeInteger(result.data.nowMs)
  );
}
export function isPeopleScope(value: unknown): value is PeopleScope {
  const result = PeopleScopeSchema.safeParse(value);
  return (
    result.success &&
    result.data.identity.length > 0 &&
    UTF8.encode(result.data.identity).length <= 1024
  );
}
export function isPeopleContextUpdate(
  value: unknown
): value is PeopleContextUpdate {
  if (!value || typeof value !== 'object' || !('action' in value)) return false;
  const action = value.action;
  if (
    action &&
    typeof action === 'object' &&
    'updates' in action &&
    (!Array.isArray(action.updates) || action.updates.length > MAX_PEOPLE_BATCH)
  )
    return false;
  const result = PeopleContextUpdateSchema.safeParse(value);
  if (!result.success || !isPeopleScope(result.data.scope)) return false;
  return (
    result.data.action.kind !== 'patch' ||
    result.data.action.updates.every(
      ({ userId, facts }) =>
        UTF8.encode(userId).length <= 1024 &&
        (facts.lastInteractionMs == null ||
          Number.isSafeInteger(facts.lastInteractionMs)) &&
        (facts.directMessage == null ||
          (UTF8.encode(facts.directMessage.name).length <= 4096 &&
            Number.isSafeInteger(facts.directMessage.timestampMs)))
    )
  );
}
export function parsePeopleContext(value: unknown): PeopleContextState {
  const result = PeopleContextStateSchema.safeParse(value);
  if (!result.success) throw new Error('Invalid contact context response');
  return result.data;
}
export function parsePeopleSearchResult(value: unknown): PeopleSearchResult {
  if (
    value &&
    typeof value === 'object' &&
    'people' in value &&
    (!Array.isArray(value.people) || value.people.length > MAX_PEOPLE_BATCH)
  )
    throw new Error('Invalid contact search response');
  const result = PeopleSearchResultSchema.safeParse(value);
  if (!result.success) throw new Error('Invalid contact search response');
  return result.data;
}
