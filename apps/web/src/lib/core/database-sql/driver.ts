/** Feeds the engine what a `RowSource` reads until it has the outcome; a write is refused. */

import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  Bin,
  Catalog,
  DatabaseView,
  EngineError,
  GqlQuery,
  Outcome,
  Page,
  RunError,
  Step,
} from './generated/types';
import {
  type DatabaseSqlReadContext,
  type DatabaseSqlRunTrace,
  type DatabaseSqlStepTrace,
  traceDatabaseSqlRun,
} from './trace';
import {
  type DatabaseSqlQuery,
  openDatabaseSqlQuery,
  openDatabaseViewQuery,
} from './wasm-module';

/** Why a statement has no outcome. */
export type DatabaseSqlFailure =
  /** The engine refused the statement or a step; `message` is its words for an agent. */
  | { kind: 'engine'; error: RunError; message: string }
  /** The engine could not be loaded or did not answer as an engine does. */
  | { kind: 'crash'; message: string }
  /** The row source could not read what the engine asked for. */
  | { kind: 'fetch'; message: string }
  /** The caller replaced or disposed this read. */
  | { kind: 'cancelled' }
  /** The statement writes, and only reads run here. */
  | { kind: 'read-only' };

export type DatabaseSqlFetchFailure = Extract<
  DatabaseSqlFailure,
  { kind: 'fetch' }
>;

/** Where rows come from. Mirrors `database_sql::run::RowSource`. */
export interface RowSource {
  /**
   * One page of a `soup` or `people` query, from `cursor` (the start when
   * `null`), at most `limit` rows, with cells keyed by property definition.
   * `needs` names the keys the engine will read; a source may ignore it.
   * `step` hears about the GraphQL request the page is read with.
   */
  page: (
    query: GqlQuery,
    needs: string[],
    cursor: string | null,
    limit: number,
    step: DatabaseSqlStepTrace
  ) => ResultAsync<Page, DatabaseSqlFetchFailure>;
  /** The bins of a `groupSoup` query. */
  bins: (
    query: GqlQuery,
    step: DatabaseSqlStepTrace
  ) => ResultAsync<Bin[], DatabaseSqlFetchFailure>;
}

/** Opens the engine for one statement; the wasm module unless a test says otherwise. */
export type OpenEngine = (
  catalog: Catalog,
  sql: string
) => Promise<DatabaseSqlQuery>;

/** Opens the engine for one view's rows; the wasm module unless a test says otherwise. */
export type OpenView = (
  catalog: Catalog,
  view: DatabaseView
) => Promise<DatabaseSqlQuery>;

function isEngineError(thrown: unknown): thrown is EngineError {
  return (
    !!thrown &&
    typeof thrown === 'object' &&
    'error' in thrown &&
    'message' in thrown &&
    typeof thrown.message === 'string'
  );
}

/** The engine throws an `EngineError`; anything else is a crash. */
export function engineFailure(thrown: unknown): DatabaseSqlFailure {
  if (isEngineError(thrown))
    return { kind: 'engine', error: thrown.error, message: thrown.message };
  return {
    kind: 'crash',
    message: thrown instanceof Error ? thrown.message : String(thrown),
  };
}

function feed(next: () => Step): Result<Step, DatabaseSqlFailure> {
  return Result.fromThrowable(next, engineFailure)();
}

function nextStep(
  query: DatabaseSqlQuery,
  step: Exclude<Step, { step: 'done' }>,
  source: RowSource,
  trace: DatabaseSqlRunTrace
): ResultAsync<Step, DatabaseSqlFailure> {
  return match(step)
    .returnType<ResultAsync<Step, DatabaseSqlFailure>>()
    .with({ step: 'fetch' }, (request) =>
      trace
        .fetch(
          request,
          (traced) =>
            source.page(
              request.query,
              request.needs,
              request.cursor,
              request.limit,
              traced
            ),
          (page) => page.rows.length
        )
        .andThen((page) =>
          trace.fold(() => feed(() => query.feed_page(request.id, page)))
        )
    )
    .with({ step: 'bins' }, (request) =>
      trace
        .fetch(
          request,
          (traced) => source.bins(request.query, traced),
          (bins) => bins.length
        )
        .andThen((bins) =>
          trace.fold(() => feed(() => query.feed_bins(request.id, bins)))
        )
    )
    .with({ step: 'ops' }, () =>
      errAsync<Step, DatabaseSqlFailure>({ kind: 'read-only' })
    )
    .exhaustive();
}

async function steps(
  query: DatabaseSqlQuery,
  source: RowSource,
  trace: DatabaseSqlRunTrace,
  signal?: AbortSignal
): Promise<Result<Outcome, DatabaseSqlFailure>> {
  if (signal?.aborted) return err({ kind: 'cancelled' });
  let step = trace.start(() => feed(() => query.start()));
  while (step.isOk()) {
    if (signal?.aborted) return err({ kind: 'cancelled' });
    const current = step.value;
    if (current.step === 'done') {
      const { step: _done, ...outcome } = current;
      return ok(outcome);
    }
    step = await nextStep(query, current, source, trace);
  }
  return err(signal?.aborted ? { kind: 'cancelled' } : step.error);
}

function drive(
  opened: () => Promise<DatabaseSqlQuery>,
  source: RowSource,
  trace: DatabaseSqlRunTrace,
  signal?: AbortSignal
): ResultAsync<Outcome, DatabaseSqlFailure> {
  if (signal?.aborted) return errAsync({ kind: 'cancelled' });
  return ResultAsync.fromPromise(trace.open(opened), (thrown) =>
    signal?.aborted ? ({ kind: 'cancelled' } as const) : engineFailure(thrown)
  ).andThen((query) => {
    const read = async () => {
      try {
        return await steps(query, source, trace, signal);
      } finally {
        query.free();
      }
    };
    return new ResultAsync(read());
  });
}

/** Run a read-only statement to its outcome; a write is refused. */
export function runDatabaseSql(
  catalog: Catalog,
  sql: string,
  {
    source,
    open = openDatabaseSqlQuery,
    context,
    signal,
  }: {
    source: RowSource;
    open?: OpenEngine;
    context?: DatabaseSqlReadContext;
    signal?: AbortSignal;
  }
): ResultAsync<Outcome, DatabaseSqlFailure> {
  return traceDatabaseSqlRun(
    { kind: 'sql', sql },
    catalog,
    (trace) => drive(() => open(catalog, sql), source, trace, signal),
    context
  );
}

/** Read the rows a view shows, as its compiled query finds them. */
export function runDatabaseView(
  catalog: Catalog,
  view: DatabaseView,
  {
    source,
    open = openDatabaseViewQuery,
    context,
    signal,
  }: {
    source: RowSource;
    open?: OpenView;
    context?: DatabaseSqlReadContext;
    signal?: AbortSignal;
  }
): ResultAsync<Outcome, DatabaseSqlFailure> {
  return traceDatabaseSqlRun(
    { kind: 'view', view },
    catalog,
    (trace) => drive(() => open(catalog, view), source, trace, signal),
    context
  );
}

const NO_ROWS: RowSource = {
  page: () => okAsync({ rows: [], next: null }),
  bins: () => okAsync([]),
};

/** Compile and plan a statement with every fetch answering no rows; a write is refused. */
export function checkReadStatement(
  catalog: Catalog,
  sql: string,
  { open = openDatabaseSqlQuery }: { open?: OpenEngine } = {}
): ResultAsync<void, DatabaseSqlFailure> {
  return traceDatabaseSqlRun({ kind: 'check', sql }, catalog, (trace) =>
    drive(() => open(catalog, sql), NO_ROWS, trace)
  ).andThen((outcome) =>
    outcome.columns.length > 0
      ? okAsync(undefined)
      : errAsync<void, DatabaseSqlFailure>({ kind: 'read-only' })
  );
}
