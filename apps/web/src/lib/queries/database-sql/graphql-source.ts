/**
 * The engine's browser row source: tables are read as Soup database rows through the
 * normalized cache, newest first; `people` come from the contacts query.
 */

import { readRecordsByKeys, selectRecords } from '@app/lib/graphql-cache';
import type {
  DatabaseSqlFetchFailure,
  RowSource,
} from '@core/database-sql/driver';
import type {
  Bin,
  Catalog,
  Cell,
  GqlQuery,
  KeyHint,
  Page,
  Propf,
  Row,
  Table,
} from '@core/database-sql/generated/types';
import type { DatabaseSqlStepTrace } from '@core/database-sql/trace';
import type { CacheHost } from '@graphql-cache/host/types';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import {
  materializeReconciledSoup,
  soupReconciliationBaseline,
} from '@queries/soup/graphql/reconciliation';
import {
  type DatabaseRowFieldsFragment,
  DatabaseRowFieldsFragmentDoc,
  DatabaseRowsDocument,
  type DatabaseRowsQuery,
  type DatabaseRowsQueryVariables,
  type GraphqlDatabaseRowExpr,
  type GraphqlEntityFilterAst,
  type GraphqlFilterPropertiesExpr,
  GroupSoupDocument,
  type GroupSoupQuery,
  type GroupSoupQueryVariables,
  type SoupInput,
  type SoupPropertyValueFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import {
  type AnyVariables,
  type Client,
  type DocumentInput,
  type RequestPolicy,
  stringifyDocument,
} from '@urql/core';
import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { NIL as NIL_UUID, v5 as uuidV5 } from 'uuid';

/** One person the viewer can see, as the `people` table lists them. */
export interface Person {
  id: string;
  name: string;
  email: string;
}

interface GraphqlRowSourceCapabilities {
  /** The app's GraphQL client; its exchanges decide cache or network. */
  client: Client;
  /** The statement's catalog, for the value kinds of grouped columns. */
  catalog: Catalog;
  requestPolicy: RequestPolicy;
  /** Everyone the viewer can see. */
  people: () => Promise<Person[]>;
  /**
   * Table membership as the local filter index knows it. A read from the
   * network records each first page as evidence; a later read with
   * `reconcile` set answers a table that fit in one page from the cache's
   * index instead, so rows the cache learned about since show up.
   */
  membership?: LocalMembership;
}

/** Local reconciliation for first pages, shared across runs of a statement. */
export interface LocalMembership {
  host: Pick<CacheHost, 'entityFilter' | 'readRecordsByKeys'>;
  /** The last network first page for each Soup input. */
  baselines: Map<
    string,
    { items: readonly DatabaseRowFieldsFragment[]; complete: boolean }
  >;
  reconcile: boolean;
}

/** Past this many join values a narrowed filter costs more than it saves. */
const MAX_KEY_HINT_VALUES = 100;

/**
 * `people` rows need UUID ids: the RFC 4122 OID namespace names a person's
 * row as the engine's own tests do (`Uuid::NAMESPACE_OID`).
 */
const PERSON_ROW_NAMESPACE = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

type DatabaseRowItem = Extract<
  DatabaseRowFieldsFragment,
  { __typename: 'GraphqlSoupDatabaseRow' }
>;

const rowSelection = selectRecords(DatabaseRowFieldsFragmentDoc);

function fetchFailure(message: string): DatabaseSqlFetchFailure {
  return { kind: 'fetch', message };
}

/** Anything the source could not read is a fetch failure, in its own words. */
function thrownFetchFailure(thrown: unknown): DatabaseSqlFetchFailure {
  return fetchFailure(
    thrown instanceof Error ? thrown.message : String(thrown)
  );
}

/**
 * One GraphQL read inside the step's trace; a GraphQL error or a missing
 * answer is a fetch failure.
 */
function graphqlQuery<Data, Variables extends AnyVariables>(
  client: Client,
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  requestPolicy: RequestPolicy,
  name: string,
  step: DatabaseSqlStepTrace
): ResultAsync<Data, DatabaseSqlFetchFailure> {
  step.request(stringifyDocument(document), variables);
  return ResultAsync.fromPromise(
    client
      .query(document, variables, {
        requestPolicy,
        fetchOptions: { headers: step.headers() },
      })
      .toPromise(),
    thrownFetchFailure
  ).andThen((result): Result<Data, DatabaseSqlFetchFailure> => {
    if (result.error) return err(fetchFailure(result.error.message));
    if (!result.data)
      return err(fetchFailure(`the ${name} query returned no data`));
    return ok(result.data);
  });
}

export function createGraphqlRowSource({
  client,
  catalog,
  requestPolicy,
  people,
  membership,
}: GraphqlRowSourceCapabilities): RowSource {
  return {
    page: (query, _needs, cursor, limit, step) =>
      match(query)
        .returnType<ResultAsync<Page, DatabaseSqlFetchFailure>>()
        .with({ type: 'soup' }, (soup) =>
          soupInput(soup, cursor, limit).asyncAndThen((input) =>
            soupPage(client, requestPolicy, input, membership, step)
          )
        )
        .with({ type: 'people' }, ({ ids }) => peoplePage(catalog, people, ids))
        .with({ type: 'groupSoup' }, () =>
          errAsync(fetchFailure('a grouped query is read as bins, not pages'))
        )
        .exhaustive(),
    bins: (query, step) =>
      match(query)
        .returnType<ResultAsync<Bin[], DatabaseSqlFetchFailure>>()
        .with({ type: 'groupSoup' }, (grouped) =>
          groupBins(client, requestPolicy, catalog, grouped, step)
        )
        .with({ type: P.union('soup', 'people') }, () =>
          errAsync(fetchFailure('only a grouped query has bins'))
        )
        .exhaustive(),
  };
}

/** Rows of one table and nothing else, with the pushed-down filter. */
function tableFilters(
  table: string,
  propf: Propf | null,
  keyHint: KeyHint | null
): Result<GraphqlEntityFilterAst, DatabaseSqlFetchFailure> {
  const base = buildGraphqlEntitySoupInput('DATABASE_ROW', NIL_UUID)?.initial
    ?.filters;
  if (!base)
    return err(fetchFailure('a database row Soup input is unavailable'));
  let rows: GraphqlDatabaseRowExpr = { literal: { tableId: table } };
  let properties = propf ? propertiesExpression(propf) : undefined;
  const hint = keyHint ? narrowing(keyHint) : undefined;
  if (hint?.kind === 'rows')
    rows = { and: { left: rows, right: hint.expression } };
  if (hint?.kind === 'properties') {
    properties = properties
      ? { and: { left: properties, right: hint.expression } }
      : hint.expression;
  }
  return ok({
    ...base,
    databaseRowFilter: rows,
    ...(properties ? { propertiesFilter: properties } : {}),
  });
}

function soupInput(
  { table, propf, keyHint }: Extract<GqlQuery, { type: 'soup' }>,
  cursor: string | null,
  limit: number
): Result<SoupInput, DatabaseSqlFetchFailure> {
  if (cursor) {
    return ok({
      continuation: { cursor, expand: true, sortDirection: 'DESC' },
    });
  }
  return tableFilters(table, propf, keyHint).map((filters) => ({
    initial: {
      limit,
      expand: true,
      sortMethod: 'CREATED_AT',
      sortDirection: 'DESC',
      filters,
    },
  }));
}

/** The engine's `propf` wire form as the GraphQL properties filter. */
function propertiesExpression(propf: Propf): GraphqlFilterPropertiesExpr {
  return match(propf)
    .returnType<GraphqlFilterPropertiesExpr>()
    .with({ '&': P.nonNullable }, ({ '&': [left, right] }) => ({
      and: {
        left: propertiesExpression(left),
        right: propertiesExpression(right),
      },
    }))
    .with({ '|': P.nonNullable }, ({ '|': [left, right] }) => ({
      or: {
        left: propertiesExpression(left),
        right: propertiesExpression(right),
      },
    }))
    .with({ '!': P.nonNullable }, ({ '!': inner }) => ({
      not: propertiesExpression(inner),
    }))
    .with({ l: P.nonNullable }, ({ l: { pd, v } }) => ({
      literal: {
        propertyDefinitionId: pd,
        value: match(v)
          .with({ so: P.string }, ({ so }) => ({ selectOption: so }))
          .with({ er: P.string }, ({ er }) => ({ entityRef: er }))
          .exhaustive(),
      },
    }))
    .exhaustive();
}

/** A balanced OR keeps a long list inside the filter depth limit. */
function balancedOr<Expression>(
  items: Expression[],
  or: (left: Expression, right: Expression) => Expression
): Expression | undefined {
  if (items.length < 2) return items[0];
  const middle = Math.floor(items.length / 2);
  const left = balancedOr(items.slice(0, middle), or);
  const right = balancedOr(items.slice(middle), or);
  return left && right ? or(left, right) : (left ?? right);
}

/**
 * A filter fetching only the joined rows the join can match. The fold
 * applies the join regardless, so a hint that cannot be expressed fetches
 * the whole table instead.
 */
function narrowing(
  hint: KeyHint
):
  | { kind: 'rows'; expression: GraphqlDatabaseRowExpr }
  | { kind: 'properties'; expression: GraphqlFilterPropertiesExpr }
  | undefined {
  type Member = { kind: 'entity' | 'option' | 'other'; id: string };
  const members = hint.values.flatMap((value): Member[] =>
    match(value)
      .returnType<Member[]>()
      .with({ type: 'entities' }, ({ value }) =>
        value.map((id) => ({ kind: 'entity', id }))
      )
      .with({ type: 'row' }, ({ value }) => [{ kind: 'entity', id: value }])
      .with({ type: 'options' }, ({ value }) =>
        value.map((id) => ({ kind: 'option', id }))
      )
      .otherwise(() => [{ kind: 'other', id: '' }])
  );
  if (
    members.length === 0 ||
    members.length > MAX_KEY_HINT_VALUES ||
    members.some((member) => member.kind === 'other')
  )
    return undefined;
  const column = hint.column;
  if (column === null) {
    const expression = balancedOr<GraphqlDatabaseRowExpr>(
      members.map(({ id }) => ({ literal: { id } })),
      (left, right) => ({ or: { left, right } })
    );
    return expression && { kind: 'rows', expression };
  }
  const expression = balancedOr<GraphqlFilterPropertiesExpr>(
    members.map(({ kind, id }) => ({
      literal: {
        propertyDefinitionId: column,
        value: kind === 'option' ? { selectOption: id } : { entityRef: id },
      },
    })),
    (left, right) => ({ or: { left, right } })
  );
  return expression && { kind: 'properties', expression };
}

function soupPage(
  client: Client,
  requestPolicy: RequestPolicy,
  input: SoupInput,
  membership: LocalMembership | undefined,
  step: DatabaseSqlStepTrace
): ResultAsync<Page, DatabaseSqlFetchFailure> {
  const evidence = input.initial ? JSON.stringify(input) : undefined;
  const local: ResultAsync<Page | undefined, DatabaseSqlFetchFailure> =
    evidence && membership?.reconcile
      ? reconciledPage(input, evidence, membership)
      : okAsync(undefined);
  return local.andThen((page) =>
    page
      ? okAsync(page)
      : graphqlQuery<DatabaseRowsQuery, DatabaseRowsQueryVariables>(
          client,
          DatabaseRowsDocument,
          { input },
          requestPolicy,
          'database rows',
          step
        ).andThen((data) => {
          const { items, nextCursor } = data.user.soup;
          if (evidence && membership && isNetworkRead(requestPolicy)) {
            membership.baselines.set(evidence, {
              items,
              complete: nextCursor === null,
            });
          }
          return tableRows(items).map((rows) => ({ rows, next: nextCursor }));
        })
  );
}

function isNetworkRead(requestPolicy: RequestPolicy): boolean {
  return (
    requestPolicy === 'network-only' || requestPolicy === 'cache-and-network'
  );
}

/**
 * The first page as the local filter index reconciles it with the last
 * network page, when that page held the whole table. `undefined` leaves the
 * read to the GraphQL client.
 */
function reconciledPage(
  input: SoupInput,
  evidence: string,
  { host, baselines }: LocalMembership
): ResultAsync<Page | undefined, DatabaseSqlFetchFailure> {
  const initial = input.initial;
  const baseline = baselines.get(evidence);
  if (!initial || !baseline?.complete) return okAsync(undefined);
  const limit = initial.limit ?? 0;
  const baselineKeys = soupReconciliationBaseline(baseline.items, 'CREATED_AT');
  if (!baselineKeys) return okAsync(undefined);
  return ResultAsync.fromPromise(
    host.entityFilter({
      filters: initial.filters ?? {},
      sortMethod: 'CREATED_AT',
      sortDirection: 'DESC',
      limit,
      baseline: baselineKeys,
    }),
    thrownFetchFailure
  ).andThen(
    (result): ResultAsync<Page | undefined, DatabaseSqlFetchFailure> => {
      if (result.kind !== 'reconciled' && result.kind !== 'complete')
        return okAsync(undefined);
      // A full page may continue past the limit; only the server's cursor knows.
      if (result.keys.length >= limit) return okAsync(undefined);
      return ResultAsync.fromPromise(
        readRecordsByKeys<DatabaseRowFieldsFragment>(
          host,
          rowSelection,
          result.keys
        ),
        thrownFetchFailure
      ).andThen(({ records }) =>
        tableRows(
          materializeReconciledSoup(result.keys, records, baseline.items)
        ).map((rows) => ({ rows, next: null }))
      );
    }
  );
}

function tableRows(
  items: readonly DatabaseRowFieldsFragment[]
): Result<Row[], DatabaseSqlFetchFailure> {
  return Result.combine(
    items.map((item) =>
      item.__typename === 'GraphqlSoupDatabaseRow'
        ? ok({ id: item.id, position: item.position, cells: rowCells(item) })
        : err(fetchFailure(`a table query returned a ${item.__typename}`))
    )
  );
}

/** A row's cells by property definition; an empty property is no cell. */
function rowCells(item: DatabaseRowItem): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const property of item.properties) {
    const value = cell(property.value);
    if (value) cells[property.propertyDefinitionId] = value;
  }
  return cells;
}

/** A property value as the engine reads it, matching the server's source. */
function cell(
  value: SoupPropertyValueFieldsFragment | null | undefined
): Cell | undefined {
  if (!value) return undefined;
  return match(value)
    .returnType<Cell>()
    .with({ __typename: 'GraphqlBooleanPropertyValue' }, ({ boolValue }) => ({
      type: 'bool',
      value: boolValue,
    }))
    .with({ __typename: 'GraphqlNumberPropertyValue' }, ({ numberValue }) => ({
      type: 'number',
      value: numberValue,
    }))
    .with({ __typename: 'GraphqlStringPropertyValue' }, ({ stringValue }) => ({
      type: 'text',
      value: stringValue,
    }))
    .with({ __typename: 'GraphqlDatePropertyValue' }, ({ dateValue }) => ({
      type: 'date',
      value: dateValue,
    }))
    .with(
      { __typename: 'GraphqlSelectOptionPropertyValue' },
      ({ optionIds }) => ({
        type: 'options',
        value: optionIds,
      })
    )
    .with(
      { __typename: 'GraphqlEntityReferencePropertyValue' },
      ({ references }) => ({
        type: 'entities',
        value: references.map((reference) => reference.entityId),
      })
    )
    .with({ __typename: 'GraphqlLinkPropertyValue' }, ({ urls }) => ({
      type: 'text',
      value: urls.join(' '),
    }))
    .exhaustive();
}

function groupBins(
  client: Client,
  requestPolicy: RequestPolicy,
  catalog: Catalog,
  { table, propf, groupBy }: Extract<GqlQuery, { type: 'groupSoup' }>,
  step: DatabaseSqlStepTrace
): ResultAsync<Bin[], DatabaseSqlFetchFailure> {
  const kind = catalog.tables
    .find((candidate) => candidate.id === table)
    ?.columns.find((column) => column.id === groupBy)?.kind;
  const binKey = (
    key: string
  ): Result<Cell | null, DatabaseSqlFetchFailure> => {
    // Soup files rows with an empty cell under the empty key.
    if (key === '') return ok(null);
    return match(kind)
      .returnType<Result<Cell, DatabaseSqlFetchFailure>>()
      .with({ kind: 'select' }, () => ok({ type: 'options', value: [key] }))
      .with({ kind: 'entity' }, () => ok({ type: 'entities', value: [key] }))
      .otherwise(() =>
        err(fetchFailure(`column ${groupBy} cannot be grouped by Soup`))
      );
  };
  return tableFilters(table, propf, null)
    .asyncAndThen((filters) =>
      graphqlQuery<GroupSoupQuery, GroupSoupQueryVariables>(
        client,
        GroupSoupDocument,
        {
          input: {
            initial: {
              groupBy: {
                field: 'PROPERTY',
                propertyDefinitionId: groupBy,
                entityType: 'DATABASE_ROW',
              },
              // The bins' totals answer the count; one item each is enough.
              limit: 1,
              sortMethod: 'CREATED_AT',
              filters,
            },
          },
        },
        requestPolicy,
        'grouped Soup',
        step
      )
    )
    .andThen((data) =>
      Result.combine(
        data.user.groupSoup.bins.map(({ key, totalCount }) =>
          binKey(key).map((cell) => ({ key: cell, count: totalCount }))
        )
      )
    );
}

function peoplePage(
  catalog: Catalog,
  people: () => Promise<Person[]>,
  ids: string[] | null
): ResultAsync<Page, DatabaseSqlFetchFailure> {
  const table = catalog.tables.find(
    (candidate): candidate is Table => candidate.source === 'people'
  );
  if (!table) return errAsync(fetchFailure('this catalog has no people table'));
  const column = (name: string): Result<string, DatabaseSqlFetchFailure> => {
    const found = table.columns.find((candidate) => candidate.name === name);
    return found
      ? ok(found.id)
      : err(fetchFailure(`the people table has no ${name} column`));
  };
  const wanted = ids ? new Set(ids) : undefined;
  return Result.combine([
    column('id'),
    column('name'),
    column('email'),
  ]).asyncAndThen(([id, name, email]) =>
    ResultAsync.fromPromise(people(), thrownFetchFailure).map(
      (everyone): Page => ({
        rows: everyone
          .filter((person) => !wanted || wanted.has(person.id))
          .map((person) => ({
            id: uuidV5(person.id, PERSON_ROW_NAMESPACE),
            cells: {
              [id]: { type: 'entities', value: [person.id] },
              [name]: { type: 'text', value: person.name },
              [email]: { type: 'text', value: person.email },
            },
          })),
        next: null,
      })
    )
  );
}
