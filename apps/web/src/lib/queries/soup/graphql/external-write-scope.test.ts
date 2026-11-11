import { gql } from '@urql/core';
import { expect, it } from 'vitest';
import { registerGroupedSoupContinuation } from '../grouped/graphql-operation-registry';
import {
  crmExternalWriteTypes,
  resolveCrmExternalWriteTypes,
} from './external-write-scope';

it('does not fence explicitly excluded companies or non-opted-in contacts', () => {
  expect(
    crmExternalWriteTypes({
      crmCompanyFilter: {
        and: {
          left: { literal: { hidden: false } },
          right: { literal: { id: '00000000-0000-0000-0000-000000000000' } },
        },
      },
    })
  ).toEqual([]);
});

it('recovers initial fallback scope without depending on page-local context', () => {
  expect(
    resolveCrmExternalWriteTypes({
      query: gql`query Replay($page: SoupInput!) { user { soup(input: $page) { nextCursor } } }`,
      variables: {
        page: {
          initial: {
            filters: {
              crmCompanyFilter: {
                literal: { id: '00000000-0000-0000-0000-000000000000' },
              },
            },
          },
        },
      },
    })
  ).toEqual([]);
});

it('protects both CRM types when an opaque fallback cursor has no retained scope', () => {
  expect(
    resolveCrmExternalWriteTypes({
      query: gql`query Replay($input: SoupInput!) { user { soup(input: $input) { nextCursor } } }`,
      variables: { input: { continuation: { cursor: 'unregistered-page' } } },
    })
  ).toEqual(['GraphqlSoupCrmCompany', 'GraphqlSoupCrmContact']);
});

it('recovers a registered grouped fallback scope and leaves non-Soup queries alone', () => {
  const groupBy = {
    field: 'PROPERTY' as const,
    propertyDefinitionId: 'status-definition',
  };
  const initial = {
    initial: {
      groupBy,
      filters: {
        crmCompanyFilter: {
          literal: { id: '00000000-0000-0000-0000-000000000000' },
        },
        crmContactFilter: { literal: { hidden: false } },
      },
    },
  };
  const continuation = {
    continuation: { groupBy, groupKey: 'open', cursor: 'known-group' },
  };
  registerGroupedSoupContinuation(initial, continuation);
  expect(
    resolveCrmExternalWriteTypes({
      query: gql`query Replay($input: GroupedSoupInput!) { user { groupSoup(input: $input) { bins { key } } } }`,
      variables: { input: continuation },
    })
  ).toEqual(['GraphqlSoupCrmContact']);
  expect(
    resolveCrmExternalWriteTypes({
      query: gql`query Other { user { id } }`,
      variables: {},
    })
  ).toBeUndefined();
});

it('retains a CRM dependency when either OR branch can return records', () => {
  expect(
    crmExternalWriteTypes({
      crmCompanyFilter: {
        or: {
          left: { literal: { hidden: false } },
          right: { literal: { id: '00000000-0000-0000-0000-000000000000' } },
        },
      },
      crmContactFilter: {
        literal: { id: '00000000-0000-0000-0000-000000000000' },
      },
    })
  ).toEqual(['GraphqlSoupCrmCompany']);
});
