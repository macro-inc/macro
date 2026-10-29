import type { ViewQuery } from '@core/database-sql/generated/types';
import type { Client, RequestPolicy } from '@urql/core';
import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { filter, pipe, take, tap, toPromise } from 'wonka';
import {
  type DatabaseViewFilterGroup,
  type DatabaseViewFilterTest,
  type DatabaseViewQueryInput,
  DatabaseViewRowsDocument,
  type DatabaseViewRowsQuery,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

export type DatabaseViewPage =
  DatabaseViewRowsQuery['user']['databaseViewRows'];
export type DatabaseViewPageFailure = {
  kind: 'fetch';
  message: string;
  stale?: boolean;
  staleSchema?: boolean;
};
export type DatabaseViewPageRequest = {
  databaseId: string;
  tableId: string;
  query: ViewQuery;
  cursor?: string;
  requestPolicy: RequestPolicy;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** A usable cached page while a cache-and-network request revalidates. */
  onCachedPage?: (page: DatabaseViewPage) => void;
};

function filterTest(
  test: Extract<
    NonNullable<ViewQuery['filter']>['conditions'][number],
    { kind: 'condition' }
  >['test']
): DatabaseViewFilterTest | undefined {
  return (
    match(test)
      .returnType<DatabaseViewFilterTest | undefined>()
      .with({ kind: 'presence' }, ({ operator }) => ({
        presence: {
          operator: operator === 'isEmpty' ? 'IS_EMPTY' : 'IS_NOT_EMPTY',
        },
      }))
      .with({ kind: 'text' }, ({ operator, value }) => ({
        text: {
          value,
          operator: (
            {
              is: 'IS',
              isNot: 'IS_NOT',
              contains: 'CONTAINS',
              doesNotContain: 'DOES_NOT_CONTAIN',
              startsWith: 'STARTS_WITH',
              endsWith: 'ENDS_WITH',
            } as const
          )[operator],
        },
      }))
      .with({ kind: 'number' }, ({ operator, value }) => ({
        number: {
          value,
          operator: (
            {
              is: 'IS',
              isNot: 'IS_NOT',
              greaterThan: 'GREATER_THAN',
              greaterThanOrEqual: 'GREATER_THAN_OR_EQUAL',
              lessThan: 'LESS_THAN',
              lessThanOrEqual: 'LESS_THAN_OR_EQUAL',
            } as const
          )[operator],
        },
      }))
      .with({ kind: 'date' }, ({ operator, value }) => ({
        date: {
          value,
          operator: (
            {
              before: 'BEFORE',
              after: 'AFTER',
              onOrBefore: 'ON_OR_BEFORE',
              onOrAfter: 'ON_OR_AFTER',
            } as const
          )[operator],
        },
      }))
      .with({ kind: 'dateRange' }, ({ operator, value }) => ({
        dateRange: {
          value,
          operator: (
            {
              contains: 'CONTAINS',
              doesNotContain: 'DOES_NOT_CONTAIN',
              endsBefore: 'ENDS_BEFORE',
              endsOnOrAfter: 'ENDS_ON_OR_AFTER',
              startsAfter: 'STARTS_AFTER',
              startsOnOrBefore: 'STARTS_ON_OR_BEFORE',
            } as const
          )[operator],
        },
      }))
      .with({ kind: 'checkbox' }, ({ checked }) => ({ checkbox: { checked } }))
      .with({ kind: 'options' }, ({ operator, options }) => ({
        options: {
          options,
          operator: (
            {
              isAnyOf: 'IS_ANY_OF',
              isNoneOf: 'IS_NONE_OF',
              hasAny: 'HAS_ANY',
              hasAll: 'HAS_ALL',
              hasNone: 'HAS_NONE',
            } as const
          )[operator],
        },
      }))
      .with({ kind: 'entities' }, ({ operator, entities }) => ({
        entities: {
          entities,
          operator: (
            {
              isAnyOf: 'IS_ANY_OF',
              isNoneOf: 'IS_NONE_OF',
              hasAny: 'HAS_ANY',
              hasAll: 'HAS_ALL',
              hasNone: 'HAS_NONE',
            } as const
          )[operator],
        },
      }))
      // A test this build can't send fails the read instead of filtering wrongly.
      .exhaustive(() => undefined)
  );
}

function filterGroup(
  group: NonNullable<ViewQuery['filter']>
): DatabaseViewFilterGroup | undefined {
  const conditions: DatabaseViewFilterGroup['conditions'] = [];
  for (const node of group.conditions) {
    if (node.kind === 'group') {
      const nested = filterGroup(node);
      if (!nested) return undefined;
      conditions.push({ group: nested });
    } else {
      const test = filterTest(node.test);
      if (!test) return undefined;
      conditions.push({ condition: { column: node.column, test } });
    }
  }
  return {
    conjunction: group.conjunction === 'and' ? 'AND' : 'OR',
    conditions,
  };
}

/** Transport conversion only; the server checks the query against the authorized schema. */
export function databaseViewQueryInput(
  query: ViewQuery
): Result<DatabaseViewQueryInput, DatabaseViewPageFailure> {
  const filter = query.filter ? filterGroup(query.filter) : null;
  if (filter === undefined)
    return err({
      kind: 'fetch',
      message: 'This view uses a filter this version of the app cannot send.',
    });
  return ok({
    filter,
    sort: (query.sort ?? []).map(({ column, direction }) => ({
      column,
      direction: direction === 'ascending' ? 'ASCENDING' : 'DESCENDING',
    })),
  });
}

export function readDatabaseViewPage(
  request: DatabaseViewPageRequest,
  client: Client = getGraphqlSoupClient()
): ResultAsync<DatabaseViewPage, DatabaseViewPageFailure> {
  const query = databaseViewQueryInput(request.query);
  if (query.isErr()) return errAsync(query.error);
  return ResultAsync.fromPromise(
    pipe(
      client.query(
        DatabaseViewRowsDocument,
        {
          databaseId: request.databaseId,
          input: {
            tableId: request.tableId,
            query: query.value,
            cursor: request.cursor,
            limit: 500,
          },
        },
        {
          requestPolicy: request.requestPolicy,
          fetchOptions: { signal: request.signal, headers: request.headers },
        }
      ),
      tap((result) => {
        if (result.stale && result.data && !result.error)
          request.onCachedPage?.(result.data.user.databaseViewRows);
      }),
      filter((result) => !result.stale && !result.hasNext),
      take(1),
      toPromise
    ),
    (error): DatabaseViewPageFailure => ({
      kind: 'fetch',
      message: error instanceof Error ? error.message : String(error),
    })
  ).andThen(
    ({ data, error }): Result<DatabaseViewPage, DatabaseViewPageFailure> => {
      if (error || !data)
        return err({
          kind: 'fetch',
          message: error?.message ?? 'This view is not cached.',
          stale: error?.graphQLErrors.some(
            (error) => error.extensions.code === 'DATABASE_VIEW_STALE'
          ),
          staleSchema: error?.graphQLErrors.some(
            (error) => error.extensions.code === 'DATABASE_VIEW_INVALID'
          ),
        });
      return ok(data.user.databaseViewRows);
    }
  );
}
