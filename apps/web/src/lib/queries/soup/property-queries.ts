import { queryClient } from '@queries/client';
import { partialMatchKey, type Query } from '@tanstack/solid-query';
import { refreshActiveGraphqlSoupQueries } from './graphql/active-queries';
import { soupKeys } from './keys';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPropertyValueFilter(
  input: Record<string, unknown>,
  includeOptionFilters: boolean
): boolean {
  const value = input.v ?? input.value ?? input;
  return (
    isRecord(value) &&
    (value.dr !== undefined ||
      value.dateRange !== undefined ||
      value.date_range !== undefined ||
      typeof value.has_date === 'boolean' ||
      (includeOptionFilters && typeof value.so === 'string'))
  );
}
/** Match request fields, not unrelated identifiers occurring in filter values. */
function dependsOnProperty(
  input: unknown,
  definitionId: string | undefined,
  includeOptionFilters: boolean
): boolean {
  if (Array.isArray(input))
    return input.some((value) =>
      dependsOnProperty(value, definitionId, includeOptionFilters)
    );
  if (!isRecord(input)) return false;

  const matches = (id: unknown) =>
    typeof id === 'string' &&
    (definitionId === undefined || id === definitionId);
  if (
    (input.sort_method === 'property' &&
      matches(input.sort_property_definition_id)) ||
    (input.sortMethod === 'PROPERTY' && matches(input.sortPropertyDefinitionId))
  )
    return true;

  if (
    (input.type === 'property' || input.field === 'PROPERTY') &&
    matches(input.propertyDefinitionId)
  )
    return true;
  const groupBy = input.group_by;
  if (
    isRecord(groupBy) &&
    isRecord(groupBy.property) &&
    matches(groupBy.property.property_definition_id)
  )
    return true;

  const propertyId =
    input.pd ?? input.propertyDefinitionId ?? input.property_definition_id;
  if (matches(propertyId) && isPropertyValueFilter(input, includeOptionFilters))
    return true;

  return Object.values(input).some((value) =>
    dependsOnProperty(value, definitionId, includeOptionFilters)
  );
}

/** Property edits can reorder pages, admit filtered items, and change group counts. */
export async function refreshPropertyQueries(
  propertyDefinitionId?: string,
  options: {
    /** Option writes also affect membership in select-option-filtered lists. */
    includeOptionFilters?: boolean;
    /** Skip GraphQL readers maintained by a confirmed cache write; REST still refreshes. */
    unmaintainedOnly?: boolean;
  } = {}
): Promise<void> {
  const prefixes = [
    soupKeys.items._def,
    soupKeys.astItems._def,
    soupKeys.groupedGroup._def,
    soupKeys.search._def,
  ];
  const where = (input: unknown) =>
    dependsOnProperty(
      input,
      propertyDefinitionId,
      options.includeOptionFilters ?? false
    );
  const predicate = (query: Query) =>
    prefixes.some((prefix) => partialMatchKey(query.queryKey, prefix)) &&
    where(query.queryKey);
  await Promise.all([
    queryClient.invalidateQueries({ predicate }),
    refreshActiveGraphqlSoupQueries({ where, ...options }),
  ]);
}
