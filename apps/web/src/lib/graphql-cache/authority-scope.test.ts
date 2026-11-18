import {
  type GraphqlSoupEntityType,
  MoveEntitiesDocument,
  SetEntityPropertyDocument,
  type SetEntityPropertyMutationVariables,
  UpdateEntityPropertyOptionsDocument,
  type UpdateEntityPropertyOptionsMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import { parse, print } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphql')>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

import {
  excludesCrmContent,
  queryNeedsCrmProof,
  queryNeedsCrmRetirement,
  rememberOwnedEmail,
  requestNeedsCrmProof,
} from './authority-scope';

const nil = '00000000-0000-0000-0000-000000000000';
const filters = {
  emailFilter: { tree: { literal: { threadId: nil } } },
  crmCompanyFilter: { literal: { id: nil } },
};
describe('CRM cache admission classification', () => {
  it('parses a repeated document once while rechecking mutable arguments and the selected operation', () => {
    const query =
      'query Scoped($input: SoupInput!) { user { soup(input:$input) { items { id } } } } query Independent { user { favorites { id } } }';
    const mutableFilters: Record<string, unknown> = { ...filters };
    const variables = {
      input: {
        initial: {
          filters: mutableFilters,
        },
      },
    };
    vi.mocked(parse).mockClear();
    for (let index = 0; index < 100; index++)
      expect(queryNeedsCrmProof(query, variables, 'Scoped')).toBe(false);
    variables.input.initial.filters.crmAssociation = { companyId: 'company' };
    expect(queryNeedsCrmProof(query, variables, 'Scoped')).toBe(true);
    expect(queryNeedsCrmProof(query, variables, 'Independent')).toBe(false);
    expect(queryNeedsCrmProof(query, variables, 'Missing')).toBe(true);
    expect(parse).toHaveBeenCalledOnce();
  });
  it('admits an owned Soup email lookup only for its current witness', () => {
    const input = {
      entityType: 'EMAIL_THREAD' satisfies GraphqlSoupEntityType,
      id: 'owned-soup-thread',
    };
    const query =
      'query($input: SoupEntityInput!) { user { soupEntity(input:$input) { id } } }';
    let current = true;
    rememberOwnedEmail(input.id, () => current);
    expect(queryNeedsCrmProof(query, { input })).toBe(false);
    expect(
      queryNeedsCrmProof(query, {
        input: { ...input, id: 'crm-shared-thread' },
      })
    ).toBe(true);
    current = false;
    expect(queryNeedsCrmProof(query, { input })).toBe(true);
  });
  it.each([
    {
      name: 'SetEntityProperty',
      document: SetEntityPropertyDocument,
      variables: {
        input: {
          entityType: 'THREAD',
          entityId: 'owned-property-thread',
          propertyDefinitionId: 'property-definition',
          value: null,
        },
      } satisfies SetEntityPropertyMutationVariables,
    },
    {
      name: 'UpdateEntityPropertyOptions',
      document: UpdateEntityPropertyOptionsDocument,
      variables: {
        input: {
          entityType: 'THREAD',
          entityId: 'owned-tag-thread',
          properties: [
            {
              propertyDefinitionId: 'tag-definition',
              addOptionIds: ['new-tag'],
              removeOptionIds: [],
            },
          ],
        },
      } satisfies UpdateEntityPropertyOptionsMutationVariables,
    },
  ])(
    'admits $name only while its exact thread ownership witness is current',
    ({ document, variables }) => {
      const query = print(document);
      const request = { query, variables };
      expect(queryNeedsCrmProof(query, variables)).toBe(true);
      let account = 'owner';
      let session = 1;
      let generation = 'first-generation';
      rememberOwnedEmail(
        variables.input.entityId,
        () =>
          account === 'owner' &&
          session === 1 &&
          generation === 'first-generation'
      );
      expect(queryNeedsCrmProof(query, variables)).toBe(false);
      expect(requestNeedsCrmProof('enqueue-optimistic-mutation', request)).toBe(
        false
      );
      expect(
        requestNeedsCrmProof('graphql_cache_commit_optimistic_write', request)
      ).toBe(false);
      expect(queryNeedsCrmRetirement(query, variables)).toBe(true);
      expect(
        requestNeedsCrmProof('read-records-by-keys', {
          keys: ['GraphqlProperty:owned-assignment'],
        })
      ).toBe(true);
      for (const input of [
        { ...variables.input, entityId: 'foreign-thread' },
        { ...variables.input, entityType: 'COMPANY' },
        { ...variables.input, entityType: 'EMAIL_THREAD' },
        { entityType: 'THREAD' },
      ])
        expect(queryNeedsCrmProof(query, { input })).toBe(true);

      for (const invalidation of ['generation', 'account', 'session']) {
        account = 'owner';
        session = 1;
        generation = 'first-generation';
        rememberOwnedEmail(
          variables.input.entityId,
          () =>
            account === 'owner' &&
            session === 1 &&
            generation === 'first-generation'
        );
        expect(requestNeedsCrmProof('commit-optimistic-write', request)).toBe(
          false
        );
        if (invalidation === 'generation') generation = 'retired-generation';
        if (invalidation === 'account') account = 'other-owner';
        if (invalidation === 'session') session = 2;
        expect(
          requestNeedsCrmProof('graphql_cache_commit_optimistic_write', request)
        ).toBe(true);
      }
    }
  );
  it.each(['setEntityProperty', 'updateEntityPropertyOptions'])(
    'checks every aliased %s target even beside an owned thread',
    (field) => {
      const owned = `owned-${field}-thread`;
      rememberOwnedEmail(owned, () => true);
      const personal = `personal: ${field}(input:{entityType:THREAD, entityId:"${owned}"}) { id }`;
      expect(queryNeedsCrmProof(`mutation { ${personal} }`)).toBe(false);
      expect(
        queryNeedsCrmProof(
          `mutation { ${personal} shared: ${field}(input:{entityType:THREAD, entityId:"shared-thread"}) { id } }`
        )
      ).toBe(true);
      expect(
        queryNeedsCrmProof(
          `mutation { ${personal} crm: ${field}(input:{entityType:COMPANY, entityId:"${owned}"}) { id } }`
        )
      ).toBe(true);
    }
  );
  it('continues checking siblings of personal resolver fields', () => {
    expect(
      queryNeedsCrmProof(
        '{ user { workFeed { entries { id } } soupEntity(input:{entityType:CRM_CONTACT}) { id } } }'
      )
    ).toBe(true);
    expect(
      queryNeedsCrmProof(
        '{ user { emailFocus { id } favorites { id } databaseViewRows { items { id } } } }'
      )
    ).toBe(false);
  });
  it('admits owned mailbox mutation results while checking other root selections', () => {
    const personal =
      'changed: markEmailThreadSeen(input:{threadId:"owned"}) { ...Thread }';
    const fragment = 'fragment Thread on GraphqlSoupEmailThread { id isRead }';
    expect(queryNeedsCrmProof(`mutation { ${personal} } ${fragment}`)).toBe(
      false
    );
    expect(
      queryNeedsCrmProof(
        `mutation { ${personal} private: setEntityProperty(input:{entityType:CRM_CONTACT}) { id } } ${fragment}`
      )
    ).toBe(true);
    // The same result type reached through an entity grant still needs proof.
    expect(
      queryNeedsCrmProof(
        `query { user { emailThread(input:{threadId:"shared"}) { ...Thread } } } ${fragment}`
      )
    ).toBe(true);
  });
  it('admits folder moves whose server effects contain only independent entities', () => {
    const query = print(MoveEntitiesDocument);
    const owned = {
      entity: { type: 'EMAIL_THREAD', id: 'owned-move-thread' },
      projectId: 'folder',
    };
    expect(queryNeedsCrmProof(query, { inputs: [owned] })).toBe(false);
    expect(queryNeedsCrmProof(query, { inputs: owned })).toBe(false);
    expect(
      queryNeedsCrmProof(query, {
        inputs: [
          { entity: { type: 'DOCUMENT', id: 'doc' }, projectId: 'folder' },
        ],
      })
    ).toBe(false);
    expect(
      queryNeedsCrmProof(query, {
        inputs: [
          owned,
          {
            entity: { type: 'CRM_COMPANY', id: 'company' },
            projectId: 'folder',
          },
        ],
      })
    ).toBe(true);
    // A move cannot return an email solely via CRM: the server requires Owner.
    expect(
      queryNeedsCrmProof(query, {
        inputs: [
          {
            entity: { type: 'EMAIL_THREAD', id: 'unknown-thread' },
            projectId: 'folder',
          },
        ],
      })
    ).toBe(false);
    expect(queryNeedsCrmProof(query, {})).toBe(true);
  });
  it('allows only minimal mail ownership metadata before an ownership witness', () => {
    const request = {
      keys: ['GraphqlSoupEmailThread:unknown'],
      fragmentName: 'Owner',
      document: 'fragment Owner on GraphqlSoupEmailThread { id ownerId }',
    };
    expect(requestNeedsCrmProof('read-records-by-keys', request)).toBe(false);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        ...request,
        document:
          'fragment Owner on GraphqlSoupEmailThread { id ownerId cacheProjection }',
      })
    ).toBe(true);
  });
  it('resolves each aliased entity lookup independently and closes unknown kinds', () => {
    const query =
      'query($a: SoupEntityInput!, $b: SoupEntityInput!) { user { safe: soupEntity(input: $a) { id } private: soupEntity(input: $b) { id } } }';
    expect(
      queryNeedsCrmProof(query, {
        a: { entityType: 'DOCUMENT' },
        b: { entityType: 'CRM_CONTACT' },
      })
    ).toBe(true);
    expect(
      queryNeedsCrmProof(query, {
        a: { entityType: 'DOCUMENT' },
        b: { entityType: 'UNKNOWN' },
      })
    ).toBe(true);
    expect(
      queryNeedsCrmProof(
        'query { user { soupEntity(input: {entityType: DOCUMENT}) { id } } }'
      )
    ).toBe(false);
  });
  it('requires a positive exclusion under the real initial input, not a negated or cursor filter', () => {
    expect(excludesCrmContent(filters)).toBe(true);
    expect(
      excludesCrmContent({
        ...filters,
        crmCompanyFilter: { not: filters.crmCompanyFilter },
      })
    ).toBe(false);
    const query =
      'query($input: SoupInput!) { user { soup(input: $input) { items { id } } } }';
    expect(queryNeedsCrmProof(query, { input: { initial: { filters } } })).toBe(
      false
    );
    expect(
      queryNeedsCrmProof(query, { input: { after: 'cursor', filters } })
    ).toBe(true);
  });
  it('protects raw viewer aggregates and unwraps native scoped hydration', () => {
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlUser:viewer'],
      })
    ).toBe(true);
    expect(
      requestNeedsCrmProof('graphql_cache_hydrate_scoped', {
        request: {
          query: '{ user { emailThread(input:{threadId:"a"}) { id } } }',
        },
      })
    ).toBe(true);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlSoupDocument:a'],
      })
    ).toBe(false);
  });
  it('keeps ordinary database row contracts independent while CRM pipeline and association content stays protected', () => {
    const query =
      'query($input: SoupInput!) { user { soup(input:$input) { items { ... on GraphqlSoupDatabaseRow { id } } } } }';
    const rowFilters = {
      ...filters,
      databaseRowFilter: { literal: { tableId: 'table' } },
    };
    expect(
      queryNeedsCrmProof(query, { input: { initial: { filters: rowFilters } } })
    ).toBe(false);
    expect(
      queryNeedsCrmProof(query, {
        input: {
          initial: {
            filters: { ...rowFilters, crmAssociation: { company: 'company' } },
          },
        },
      })
    ).toBe(true);
    expect(
      queryNeedsCrmProof(
        '{ user { soupEntity(input:{entityType:DATABASE_ROW,id:"row"}) { id } } }'
      )
    ).toBe(false);
    expect(
      requestNeedsCrmProof('entity-filter', {
        request: { filters: rowFilters },
      })
    ).toBe(false);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlSoupDatabaseRow:row'],
      })
    ).toBe(false);
    expect(
      requestNeedsCrmProof('read-records-by-keys', {
        keys: ['GraphqlCrmPipelineEntry:entry'],
      })
    ).toBe(true);
  });
});

it('retires witnessed literal mail selections without gating independent documents', () => {
  const threadId = crypto.randomUUID();
  rememberOwnedEmail(threadId, () => true);
  const query = `{ user { emailThread(input: {threadId: "${threadId}"}) { id } } }`;
  expect(queryNeedsCrmProof(query)).toBe(false);
  expect(queryNeedsCrmRetirement(query)).toBe(true);
  expect(queryNeedsCrmRetirement('{ document(id: "note") { id } }')).toBe(
    false
  );
});

it('keeps variable-scoped independent queries outside CRM retirement', () => {
  const soup =
    'query($input: SoupInput!) { user { soup(input:$input) { items { id } } } }';
  expect(
    queryNeedsCrmRetirement(soup, { input: { initial: { filters } } })
  ).toBe(false);
  const entity =
    'query($input: SoupEntityInput!) { user { soupEntity(input:$input) { id } } }';
  expect(
    queryNeedsCrmRetirement(entity, {
      input: { entityType: 'DOCUMENT', id: 'note' },
    })
  ).toBe(false);
});
