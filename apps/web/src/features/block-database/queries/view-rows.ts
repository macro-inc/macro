import {
  type DatabaseSqlFailure,
  engineFailure,
} from '@core/database-sql/driver';
import type {
  Catalog,
  ColumnKind,
  Outcome,
  OutcomeKind,
} from '@core/database-sql/generated/types';
import {
  profileDatabasePhase,
  traceDatabaseFrame,
} from '@core/database-sql/profile';
import type { DatabaseSqlReadReason } from '@core/database-sql/trace';
import { buildDatabaseSqlCatalog } from '@core/database-sql/wasm-module';
import { Telemetry } from '@macro-inc/observability';
import type {
  DatabaseSqlQuery,
  DatabaseSqlRun,
  DatabaseSqlStatement,
} from '@queries/database-sql/create-database-sql-query';
import { rowCells } from '@queries/database-sql/graphql-source';
import {
  type DatabaseViewPage,
  type DatabaseViewPageRequest,
  readDatabaseViewPage,
} from '@service-storage/database-view-rows';
import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { DatabaseRowsPagination } from '../../database/context/table-source';

export type DatabaseViewQuery = DatabaseSqlQuery & {
  pagination?: DatabaseRowsPagination;
};
type Capabilities = {
  readPage: typeof readDatabaseViewPage;
  catalog: typeof buildDatabaseSqlCatalog;
};

function outcomeKind(kind: ColumnKind): OutcomeKind {
  return match(kind)
    .returnType<OutcomeKind>()
    .with({ kind: 'text' }, { kind: 'link' }, () => 'text')
    .with({ kind: 'number' }, () => 'number')
    .with({ kind: 'boolean' }, () => 'boolean')
    .with({ kind: 'date' }, () => 'date')
    .with({ kind: 'select' }, () => 'select')
    .with({ kind: 'entity' }, () => 'entity')
    .exhaustive();
}

/** View order and membership are authoritative server facts; cells retain their shared cache identity. */
export function createDatabaseViewQuery(
  statement: Accessor<DatabaseSqlStatement | undefined>,
  capabilities: Capabilities = {
    readPage: readDatabaseViewPage,
    catalog: buildDatabaseSqlCatalog,
  }
): DatabaseViewQuery {
  const readStatement = createMemo(statement, undefined, {
    equals: (left, right) => {
      const key = (value: DatabaseSqlStatement | undefined) =>
        value?.view &&
        JSON.stringify({
          schema: value.schema,
          scope: value.scope,
          table: value.view.tableId,
          query: value.view.query,
        });
      return key(left) === key(right);
    },
  });
  const [outcome, setOutcome] = createSignal<Outcome>();
  const [catalog, setCatalog] = createSignal<Catalog>();
  const [error, setError] = createSignal<DatabaseSqlFailure>();
  const [loading, setLoading] = createSignal(false);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [cursor, setCursor] = createSignal<string>();
  const [version, setVersion] = createSignal<number>();
  let pages: DatabaseViewPage[] = [];
  let generation = 0;
  let active: AbortController | undefined;
  let cancelFrame: (() => void) | undefined;

  function request(
    current: DatabaseSqlStatement,
    signal: AbortSignal,
    next?: string
  ): DatabaseViewPageRequest | undefined {
    return current.view
      ? {
          databaseId: current.view.databaseId,
          tableId: current.view.tableId,
          query: current.view.query,
          cursor: next,
          requestPolicy: 'network-only',
          signal,
        }
      : undefined;
  }

  function publish(
    built: Catalog,
    tableId: string,
    next: DatabaseViewPage[],
    span: ReturnType<typeof Telemetry.span>,
    previous?: Outcome
  ) {
    const table = built.tables.find((table) => table.id === tableId);
    if (!table) throw new Error('The view table is missing from its catalog.');
    const items = (previous ? next.slice(-1) : next).flatMap(
      (page) => page.items
    );
    const decoded = profileDatabasePhase(
      span.span('database_sql.rows.decode'),
      () =>
        items.map((item) => {
          const cells = rowCells(item);
          return table.columns.map((column) => cells[column.id] ?? null);
        })
    );
    const answer: Outcome = {
      columns:
        previous?.columns ??
        table.columns.map((column) => ({
          name: column.name,
          column: column.id,
          kind: outcomeKind(column.kind),
        })),
      rows: [...(previous?.rows ?? []), ...decoded],
      rowIds: [...(previous?.rowIds ?? []), ...items.map((item) => item.id)],
      readTables: [tableId],
      truncated: false,
      insertedRowIds: [],
      changesApplied: 0,
    };
    span.setAttr('database_sql.row_count', answer.rows.length);
    profileDatabasePhase(span.span('database_sql.publish'), () =>
      batch(() => {
        pages = next;
        setCatalog(built);
        setOutcome(answer);
        setCursor(next.at(-1)?.nextCursor ?? undefined);
        setVersion(next[0]?.version);
        setError(undefined);
      })
    );
    cancelFrame?.();
    cancelFrame = traceDatabaseFrame(span.span('database_sql.frame'));
  }

  function refresh(
    reason: DatabaseSqlReadReason = 'refresh',
    cached = false,
    count = Math.max(1, pages.length)
  ): ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> {
    const current = untrack(readStatement);
    if (!current?.view) return okAsync({ landed: false });
    const run = ++generation;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const input = request(current, controller.signal);
    if (!input) return okAsync({ landed: false });
    setLoading(true);
    setLoadingMore(false);
    const span = Telemetry.span('database_sql.query');
    span.setAttr('database_sql.execution', 'server-view');
    span.setAttr('database_sql.read_reason', reason);
    span.setAttr('database_sql.table_id', input.tableId);
    const headers: Record<string, string> = {};
    span.injectTraceHeaders(headers);
    input.headers = headers;
    const read = async (): Promise<
      Result<DatabaseSqlRun, DatabaseSqlFailure>
    > => {
      const built = await capabilities.catalog(current.schema, current.scope);
      if (run !== generation) return ok({ landed: false });
      // A concurrent write may invalidate an in-progress multi-page refresh once.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const fresh: DatabaseViewPage[] = [];
        let next: string | undefined;
        for (let index = 0; index < count; index += 1) {
          const initial = cached && attempt === 0 && index === 0;
          const page = await capabilities.readPage({
            ...input,
            cursor: next,
            requestPolicy: initial ? 'cache-and-network' : 'network-only',
            onCachedPage: initial
              ? (page) => {
                  if (run === generation)
                    publish(built, input.tableId, [page], span);
                }
              : undefined,
          });
          if (run !== generation) return ok({ landed: false });
          if (page.isErr()) {
            if (page.error.stale && attempt === 0) break;
            // A fast offline failure may arrive before the worker's cache hit.
            if (initial) {
              const saved = await capabilities.readPage({
                ...input,
                requestPolicy: 'cache-only',
              });
              if (run !== generation) return ok({ landed: false });
              if (saved.isOk())
                publish(built, input.tableId, [saved.value], span);
            }
            return err(page.error);
          }
          fresh.push(page.value);
          next = page.value.nextCursor ?? undefined;
          if (!next || index === count - 1) {
            publish(built, input.tableId, fresh, span);
            return ok({ landed: true });
          }
        }
      }
      return err({
        kind: 'fetch',
        message: 'The table is changing. Refresh to read its latest rows.',
      });
    };
    return ResultAsync.fromPromise(read(), engineFailure)
      .andThen((result) => result)
      .orTee((failure) => {
        if (run === generation) setError(failure);
      })
      .andTee(() => {
        if (run === generation) setLoading(false);
        span.end();
      })
      .orTee(() => {
        if (run === generation) setLoading(false);
        span.end();
      });
  }

  function loadMore(): ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> {
    const current = untrack(readStatement);
    const built = untrack(catalog);
    const next = untrack(cursor);
    if (!current || !built || !next || loading() || loadingMore() || !active)
      return okAsync({ landed: false });
    const run = generation;
    const input = request(current, active.signal, next);
    if (!input) return okAsync({ landed: false });
    setLoadingMore(true);
    const span = Telemetry.span('database.view.load_more');
    const headers: Record<string, string> = {};
    span.injectTraceHeaders(headers);
    return capabilities
      .readPage({ ...input, headers })
      .andThen((page): Result<DatabaseSqlRun, DatabaseSqlFailure> => {
        if (run !== generation) return ok({ landed: false });
        publish(built, input.tableId, [...pages, page], span, untrack(outcome));
        return ok({ landed: true });
      })
      .orElse((failure) => {
        if (run !== generation) return okAsync({ landed: false });
        if ('stale' in failure && failure.stale)
          return refresh('refresh', false, pages.length + 1);
        setError(failure);
        return new ResultAsync(
          Promise.resolve(err<DatabaseSqlRun, DatabaseSqlFailure>(failure))
        );
      })
      .andTee(() => {
        if (run === generation) setLoadingMore(false);
        span.end();
      })
      .orTee(() => {
        if (run === generation) setLoadingMore(false);
        span.end();
      });
  }

  createEffect(
    on(readStatement, (current, previous) => {
      pages = [];
      setCursor(undefined);
      setVersion(undefined);
      setError(undefined);
      if (!current) {
        generation += 1;
        active?.abort();
        setOutcome(undefined);
        setCatalog(undefined);
        setLoading(false);
        return;
      }
      void refresh(previous ? 'statement-change' : 'initial', true, 1);
    })
  );
  onCleanup(() => {
    generation += 1;
    active?.abort();
    cancelFrame?.();
  });
  return {
    outcome,
    catalog,
    error,
    loading,
    refresh,
    // A changed row may enter or leave the global page; only the server can decide membership.
    cached: () => false,
    answerFromCache: () => refresh('cache-reconcile'),
    pagination: {
      hasMore: () => !!cursor(),
      loading: loadingMore,
      version,
      loadMore,
    },
  };
}
