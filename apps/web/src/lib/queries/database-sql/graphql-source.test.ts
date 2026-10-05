import { runDatabaseSql } from '@core/database-sql/driver';
import { readTranscript, replay } from '@core/database-sql/tests/transcript';
import type {
  DatabaseRowFieldsFragment,
  DatabaseRowsQuery,
  GroupSoupQuery,
  SoupPropertyValueFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { createClient, type Exchange, type Operation } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { empty, fromValue, mergeMap, pipe } from 'wonka';
import { createGraphqlRowSource } from './graphql-source';

const DEALS = '01990000-0000-7000-8000-00000000d001';
const PEOPLE = '01990000-0000-7000-8000-00000000d002';
const NAME = '01990000-0000-7000-8000-00000000c001';
const AMOUNT = '01990000-0000-7000-8000-00000000c002';
const STAGE = '01990000-0000-7000-8000-00000000c003';
const OWNER = '01990000-0000-7000-8000-00000000c004';
const LEAD = '01990000-0000-7000-8000-00000000a001';
const WON = '01990000-0000-7000-8000-00000000a002';
const ACME = '01990000-0000-7000-8000-00000000e001';
const GLOBEX = '01990000-0000-7000-8000-00000000e002';
const INITECH = '01990000-0000-7000-8000-00000000e003';
const SAM = '01990000-0000-7000-8000-00000000f001';
const NIL = '00000000-0000-0000-0000-000000000000';

type SoupItem = DatabaseRowFieldsFragment;
type RowProperty = Extract<
  SoupItem,
  { __typename: 'GraphqlSoupDatabaseRow' }
>['properties'][number];

/** Every Soup kind but rows, ruled out the way the app rules them out. */
const everyOtherKindExcluded = {
  calendarEventFilter: { literal: { id: NIL } },
  documentFilter: { literal: { id: NIL } },
  projectFilter: { literal: { projectIdSelf: NIL } },
  chatFilter: { literal: { chatId: NIL } },
  emailFilter: { tree: { literal: { threadId: NIL } } },
  channelFilter: { literal: { channelId: NIL } },
  channelThreadFilter: { literal: { threadId: NIL } },
  callFilter: { literal: { callId: NIL } },
  crmCompanyFilter: { literal: { id: NIL } },
  foreignEntityFilter: { literal: { id: NIL } },
};

function property(
  definition: string,
  value: SoupPropertyValueFieldsFragment
): RowProperty {
  return { id: `${definition}-value`, propertyDefinitionId: definition, value };
}

function row(
  id: string,
  table: string,
  position: string,
  properties: RowProperty[]
): SoupItem {
  return {
    __typename: 'GraphqlSoupDatabaseRow',
    id,
    tableId: table,
    position,
    ownerId: 'macro|owner@databases.test',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    cacheProjection: null,
    notifications: [],
    properties,
  };
}

const acme = row(ACME, DEALS, '80', [
  property(NAME, {
    __typename: 'GraphqlStringPropertyValue',
    stringValue: 'Acme',
  }),
  property(AMOUNT, {
    __typename: 'GraphqlNumberPropertyValue',
    numberValue: 12000,
  }),
  property(STAGE, {
    __typename: 'GraphqlSelectOptionPropertyValue',
    optionIds: [WON],
  }),
  property(OWNER, {
    __typename: 'GraphqlEntityReferencePropertyValue',
    references: [
      { entityId: SAM, entityType: 'DATABASE_ROW', specificMessageId: null },
    ],
  }),
]);
const globex = row(GLOBEX, DEALS, '8180', [
  property(NAME, {
    __typename: 'GraphqlStringPropertyValue',
    stringValue: 'Globex',
  }),
  property(AMOUNT, {
    __typename: 'GraphqlNumberPropertyValue',
    numberValue: 50000,
  }),
  property(STAGE, {
    __typename: 'GraphqlSelectOptionPropertyValue',
    optionIds: [WON],
  }),
]);
const initech = row(INITECH, DEALS, '8280', [
  property(NAME, {
    __typename: 'GraphqlStringPropertyValue',
    stringValue: 'Initech',
  }),
  property(AMOUNT, {
    __typename: 'GraphqlNumberPropertyValue',
    numberValue: 300,
  }),
  property(STAGE, {
    __typename: 'GraphqlSelectOptionPropertyValue',
    optionIds: [LEAD],
  }),
]);
const sam = row(SAM, PEOPLE, '80', [
  property(NAME, {
    __typename: 'GraphqlStringPropertyValue',
    stringValue: 'Sam',
  }),
]);

function soupPage(
  items: SoupItem[],
  nextCursor: string | null
): DatabaseRowsQuery {
  return {
    user: { id: 'macro|viewer@databases.test', soup: { items, nextCursor } },
  };
}

/** A client whose server answers each operation from `respond`, noting it. */
function fakeClient(
  respond: (operation: Operation) => DatabaseRowsQuery | GroupSoupQuery
) {
  const operations: Operation[] = [];
  const exchange: Exchange = () => (incoming) =>
    pipe(
      incoming,
      mergeMap((operation) => {
        // Settling a one-shot read tears its operation down.
        if (operation.kind === 'teardown') return empty;
        operations.push(operation);
        return fromValue({
          operation,
          data: respond(operation),
          stale: false,
          hasNext: false,
        });
      })
    );
  return {
    client: createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    }),
    variables: () => operations.map((operation) => operation.variables),
    operationNames: () =>
      operations.map(
        (operation) =>
          operation.query.definitions.find(
            (definition) => definition.kind === 'OperationDefinition'
          )?.name?.value
      ),
  };
}

const noPeople = async () => {
  throw new Error('no people in this catalog');
};

describe('the GraphQL row source', () => {
  it('reads a select-column filter as one Soup query over the table', async () => {
    const transcript = readTranscript('select-column-filter');
    const server = fakeClient(() => soupPage([acme, globex], null));

    const outcome = await runDatabaseSql(transcript.catalog, transcript.sql, {
      source: createGraphqlRowSource({
        client: server.client,
        catalog: transcript.catalog,
        requestPolicy: 'network-only',
        people: noPeople,
      }),
      open: replay(transcript),
    });

    expect(outcome._unsafeUnwrap()).toEqual(transcript.outcome);
    // Rows only: the catalog already knows each column's name and type.
    expect(server.operationNames()).toEqual(['DatabaseRows']);
    expect(server.variables()).toEqual([
      {
        input: {
          initial: {
            limit: 500,
            expand: true,
            sortMethod: 'CREATED_AT',
            sortDirection: 'DESC',
            filters: {
              ...everyOtherKindExcluded,
              databaseRowFilter: { literal: { tableId: DEALS } },
              propertiesFilter: {
                literal: {
                  propertyDefinitionId: STAGE,
                  value: { selectOption: WON },
                },
              },
            },
          },
        },
      },
    ]);
  });

  it('orders rows by their table position, though Soup lists them newest first', async () => {
    const transcript = readTranscript('row-position');
    const server = fakeClient(() => soupPage([initech, globex, acme], null));

    const outcome = await runDatabaseSql(transcript.catalog, transcript.sql, {
      source: createGraphqlRowSource({
        client: server.client,
        catalog: transcript.catalog,
        requestPolicy: 'network-only',
        people: noPeople,
      }),
      open: replay(transcript),
    });

    expect(outcome._unsafeUnwrap()).toEqual(transcript.outcome);
    expect(outcome._unsafeUnwrap().rowIds).toEqual([INITECH, ACME, GLOBEX]);
  });

  it('counts per option with groupSoup bins', async () => {
    const transcript = readTranscript('count-per-option');
    const server = fakeClient(() => ({
      user: {
        id: 'macro|viewer@databases.test',
        groupSoup: {
          bins: [
            { key: WON, totalCount: 2, nextCursor: null, items: [] },
            { key: LEAD, totalCount: 1, nextCursor: null, items: [] },
            { key: '', totalCount: 4, nextCursor: null, items: [] },
          ],
        },
      },
    }));

    const outcome = await runDatabaseSql(transcript.catalog, transcript.sql, {
      source: createGraphqlRowSource({
        client: server.client,
        catalog: transcript.catalog,
        requestPolicy: 'network-only',
        people: noPeople,
      }),
      open: replay(transcript),
    });

    expect(outcome._unsafeUnwrap()).toEqual(transcript.outcome);
    expect(server.variables()).toEqual([
      {
        input: {
          initial: {
            groupBy: {
              field: 'PROPERTY',
              propertyDefinitionId: STAGE,
              entityType: 'DATABASE_ROW',
            },
            limit: 1,
            sortMethod: 'CREATED_AT',
            filters: {
              ...everyOtherKindExcluded,
              databaseRowFilter: { literal: { tableId: DEALS } },
            },
          },
        },
      },
    ]);
  });

  it('fetches only the joined rows the key hint names, and hands their cells over by definition', async () => {
    const transcript = readTranscript('join');
    const server = fakeClient((operation) =>
      operation.variables?.input.initial.filters.databaseRowFilter.literal
        ?.tableId === DEALS
        ? soupPage([acme, initech], null)
        : soupPage([sam], null)
    );

    const outcome = await runDatabaseSql(transcript.catalog, transcript.sql, {
      source: createGraphqlRowSource({
        client: server.client,
        catalog: transcript.catalog,
        requestPolicy: 'network-only',
        people: noPeople,
      }),
      open: replay(transcript),
    });

    expect(outcome._unsafeUnwrap()).toEqual(transcript.outcome);
    expect(server.variables()[1]).toEqual({
      input: {
        initial: {
          limit: 500,
          expand: true,
          sortMethod: 'CREATED_AT',
          sortDirection: 'DESC',
          filters: {
            ...everyOtherKindExcluded,
            databaseRowFilter: {
              and: {
                left: { literal: { tableId: PEOPLE } },
                right: { literal: { id: SAM } },
              },
            },
          },
        },
      },
    });
  });

  it('follows the Soup cursor page by page', async () => {
    const transcript = readTranscript('paging');
    const server = fakeClient((operation) =>
      operation.variables?.input.continuation
        ? soupPage([globex], null)
        : soupPage([acme], 'second-page')
    );

    const outcome = await runDatabaseSql(transcript.catalog, transcript.sql, {
      source: createGraphqlRowSource({
        client: server.client,
        catalog: transcript.catalog,
        requestPolicy: 'network-only',
        people: noPeople,
      }),
      open: replay(transcript),
    });

    expect(outcome._unsafeUnwrap()).toEqual(transcript.outcome);
    expect(server.variables()).toEqual([
      {
        input: {
          initial: {
            limit: 500,
            expand: true,
            sortMethod: 'CREATED_AT',
            sortDirection: 'DESC',
            filters: {
              ...everyOtherKindExcluded,
              databaseRowFilter: { literal: { tableId: DEALS } },
            },
          },
        },
      },
      {
        input: {
          continuation: {
            cursor: 'second-page',
            expand: true,
            sortDirection: 'DESC',
          },
        },
      },
    ]);
  });
});
