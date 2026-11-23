import type { Catalog } from '@core/database-sql/generated/types';
import { buildDatabaseSqlCatalog } from '@core/database-sql/wasm-module';
import type { CacheHost } from '@graphql-cache/host/types';
import { createDatabaseSqlQuery } from '@queries/database-sql/create-database-sql-query';
import { readLocalSql } from '@queries/database-sql/local-read';
import type { DatabaseRowsQuery } from '@service-storage/graphql/generated/graphql';
import { createClient, type Exchange } from '@urql/core';
import { createSignal } from 'solid-js';
import { v5 } from 'uuid';
import { empty, fromValue, mergeMap, pipe } from 'wonka';
import { account } from './test-account';

const TABLE = '01990000-0000-7000-8000-00000000d001';
const OWNER = '01990000-0000-7000-8000-00000000c001';
const EMAIL = '01990000-0000-7000-8000-00000000c002';
const NAME = '01990000-0000-7000-8000-00000000c003';
const PERSON = 'macro|late@example.com';
async function catalog(): Promise<Catalog> {
  const people = await buildDatabaseSqlCatalog({
    databases: [],
    platform: ['people'],
  });
  return {
    tables: [
      ...people.tables,
      {
        id: TABLE,
        databaseId: '01990000-0000-7000-8000-00000000b001',
        database: 'fixture',
        name: 'rows',
        source: 'database',
        columns: [
          {
            id: OWNER,
            placement: OWNER,
            name: 'owner',
            kind: { kind: 'entity', target: 'USER', multi: false },
          },
          {
            id: EMAIL,
            placement: EMAIL,
            name: 'email',
            kind: { kind: 'text' },
          },
          { id: NAME, placement: NAME, name: 'name', kind: { kind: 'text' } },
        ],
      },
    ],
  };
}

/** Real SQL compiler/controller and local people reader; one synthetic ordinary row. */
export function SqlPeopleJoinFixture(props: { host: CacheHost }) {
  const [sql, setSql] = createSignal(
    'SELECT p.name FROM fixture.rows r JOIN macro.people p ON r.owner = p.id'
  );
  const [reads, setReads] = createSignal(0);
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      mergeMap((operation) => {
        if (operation.kind === 'teardown') return empty;
        if (operation.context.requestPolicy === 'cache-only')
          return fromValue({
            operation,
            data: undefined,
            stale: false,
            hasNext: false,
          });
        const data: DatabaseRowsQuery = {
          user: {
            id: account().userId,
            soup: {
              nextCursor: null,
              items: [
                {
                  __typename: 'GraphqlSoupDatabaseRow',
                  id: v5(PERSON, '6ba7b812-9dad-11d1-80b4-00c04fd430c8'),
                  tableId: TABLE,
                  position: '80',
                  ownerId: account().userId,
                  createdAt: '2026-01-01T00:00:00Z',
                  updatedAt: '2026-01-01T00:00:00Z',
                  cacheProjection: null,
                  notifications: [],
                  properties: [
                    {
                      id: OWNER,
                      propertyDefinitionId: OWNER,
                      value: {
                        __typename: 'GraphqlEntityReferencePropertyValue',
                        references: [
                          {
                            entityId: PERSON,
                            entityType: 'USER',
                            specificMessageId: null,
                          },
                        ],
                      },
                    },
                    {
                      id: EMAIL,
                      propertyDefinitionId: EMAIL,
                      value: {
                        __typename: 'GraphqlStringPropertyValue',
                        stringValue: 'late@example.com',
                      },
                    },
                    {
                      id: NAME,
                      propertyDefinitionId: NAME,
                      value: {
                        __typename: 'GraphqlStringPropertyValue',
                        stringValue: 'Late private name',
                      },
                    },
                  ],
                },
              ],
            },
          },
        };
        return fromValue({ operation, data, stale: false, hasNext: false });
      })
    );
  const client = createClient({
    url: 'http://test.invalid/graphql',
    exchanges: [exchange],
  });
  const query = createDatabaseSqlQuery(
    () => ({ schema: { databases: [], platform: ['people'] }, sql: sql() }),
    {
      account,
      catalog,
      client: () => client,
      cacheHost: () => undefined,
      localPeople: () => props.host,
      localRead: (input, signal) => {
        setReads((count) => count + 1);
        return readLocalSql(input, signal);
      },
    }
  );
  return (
    <main class="p-4 flex flex-col gap-2">
      <textarea
        aria-label="SQL"
        value={sql()}
        onInput={(event) => setSql(event.currentTarget.value)}
      />
      <output data-testid="join-reads">{reads()}</output>
      <output data-testid="join-error">{query.error()?.kind}</output>
      <pre data-testid="join-result">
        {JSON.stringify(query.outcome()?.rows)}
      </pre>
    </main>
  );
}
