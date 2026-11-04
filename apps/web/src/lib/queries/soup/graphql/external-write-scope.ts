import type { Operation } from '@urql/core';
import { valueFromASTUntyped, visit } from 'graphql';
import { NIL } from 'uuid';
import { groupedSoupLogicalViewKey } from '../grouped/graphql-operation-registry';

// Query observers compare context values by identity; preserve it across UI updates.
const NO_TYPES: readonly string[] = [];
const COMPANY_TYPES = ['GraphqlSoupCrmCompany'] as const;
const CONTACT_TYPES = ['GraphqlSoupCrmContact'] as const;
const CRM_TYPES = [...COMPANY_TYPES, ...CONTACT_TYPES] as const;

function excludesCrmRecords(filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return false;
  if (
    'and' in filter &&
    filter.and &&
    typeof filter.and === 'object' &&
    'left' in filter.and &&
    'right' in filter.and
  )
    return (
      excludesCrmRecords(filter.and.left) ||
      excludesCrmRecords(filter.and.right)
    );
  if (
    'or' in filter &&
    filter.or &&
    typeof filter.or === 'object' &&
    'left' in filter.or &&
    'right' in filter.or
  )
    return (
      excludesCrmRecords(filter.or.left) && excludesCrmRecords(filter.or.right)
    );
  return (
    'literal' in filter &&
    !!filter.literal &&
    typeof filter.literal === 'object' &&
    'id' in filter.literal &&
    filter.literal.id === NIL
  );
}

/** Use the initial scope for every page; opaque continuation cursors omit filters. */
export function crmExternalWriteTypes(filters: unknown): readonly string[] {
  const companyFilter =
    filters && typeof filters === 'object' && 'crmCompanyFilter' in filters
      ? filters.crmCompanyFilter
      : undefined;
  const contactFilter =
    filters && typeof filters === 'object' && 'crmContactFilter' in filters
      ? filters.crmContactFilter
      : undefined;
  const companies = !excludesCrmRecords(companyFilter);
  // Contacts are opt-in, unlike companies in a general Soup list.
  const contacts = contactFilter && !excludesCrmRecords(contactFilter);
  if (companies && contacts) return CRM_TYPES;
  if (companies) return COMPANY_TYPES;
  if (contacts) return CONTACT_TYPES;
  return NO_TYPES;
}

/** Durable descriptors omit page-local context; recover it before urql can share a request. */
export function resolveCrmExternalWriteTypes(
  operation: Pick<Operation, 'query' | 'variables'>
): readonly string[] | undefined {
  let found = false;
  const types = new Set<string>();
  visit(operation.query, {
    Field(node) {
      if (node.name.value !== 'soup' && node.name.value !== 'groupSoup') return;
      found = true;
      const argument = node.arguments?.find(
        (argument) => argument.name.value === 'input'
      );
      let input: unknown = argument
        ? valueFromASTUntyped(argument.value, operation.variables ?? {})
        : undefined;
      if (node.name.value === 'groupSoup') {
        const initial = groupedSoupLogicalViewKey(input);
        if (initial) input = JSON.parse(initial);
      }
      const initial =
        input && typeof input === 'object' && 'initial' in input
          ? input.initial
          : undefined;
      // An opaque replayed cursor may outlive every mounted reader. Its precise
      // scope is unavailable, so conservatively protect both CRM record types.
      const dependencies =
        initial && typeof initial === 'object'
          ? crmExternalWriteTypes(
              'filters' in initial ? initial.filters : undefined
            )
          : CRM_TYPES;
      for (const type of dependencies) types.add(type);
    },
  });
  return found ? [...types] : undefined;
}
