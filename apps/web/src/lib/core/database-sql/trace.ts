/**
 * Every browser run of database SQL or a view, and every ops batch, as one
 * collapsed console group and one span tree.
 */

import { type Span, Telemetry } from '@macro-inc/observability';
import type { Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  Catalog,
  DatabaseView,
  Outcome,
  Request,
  RunError,
} from './generated/types';

import { profileDatabasePhase } from './profile';

const PREFIX = '[database-sql]';
/** Long statements are cut to this many characters on the run span. */
const SQL_ATTRIBUTE_LENGTH = 4000;

/** What a run reads: a statement, a statement only compiled, or a view. */
export type DatabaseSqlSubject =
  | { kind: 'sql'; sql: string }
  | { kind: 'check'; sql: string }
  | { kind: 'view'; view: DatabaseView };

/** Why the caller is reading; contains no statement or cell content. */
export type DatabaseSqlReadReason =
  | 'initial'
  | 'statement-change'
  | 'schema-change'
  | 'refresh'
  | 'after-write'
  | 'websocket'
  | 'cache-change'
  | 'cache-reconcile'
  | 'read';

export type DatabaseSqlReadContext = {
  reason: DatabaseSqlReadReason;
  scope?: string;
  requestPolicy: string;
  /** An initial cache-only miss is expected, not a failed network read. */
  reportFailure?: boolean;
};

/** What a row source tells a step about the GraphQL request it sends. */
export interface DatabaseSqlStepTrace {
  /** Convert a page under its fetch span, independent of ambient async context. */
  decode<Value>(rows: number, operation: () => Value): Value;
  request(document: string, variables: unknown): void;
  /** W3C trace headers that put the request inside the step's span. */
  headers(): Record<string, string>;
}

/** One engine request as the trace describes it. */
export type DatabaseSqlFetch = { step: 'fetch' | 'bins' } & Request;

type FetchKind = 'table page' | 'relation page' | 'people page' | 'bins';

/** A step as the console lists it. */
export type DatabaseSqlStepRecord = {
  kind: FetchKind;
  table: string | null;
  page: number;
  hints: number;
  cursor: string | null;
  requests: { document: string; variables: unknown }[];
  rows?: number;
  error?: string;
  milliseconds: number;
  foldMilliseconds?: number;
};

/** What the driver asks of a run's trace while it drives the engine. */
export interface DatabaseSqlRunTrace {
  /** Compile/open and start under this run even after an async boundary. */
  open<Value>(operation: () => Promise<Value>): Promise<Value>;
  start<Value>(operation: () => Value): Value;
  /** Read a step's rows inside its span; `count` says how many came back. */
  fetch<Value, Failure>(
    request: DatabaseSqlFetch,
    read: (step: DatabaseSqlStepTrace) => ResultAsync<Value, Failure>,
    count: (value: Value) => number
  ): ResultAsync<Value, Failure>;
  /** Feed the engine what the last fetch read. */
  fold<Value, Failure>(
    feed: () => Result<Value, Failure>
  ): Result<Value, Failure>;
}

function fetchKind(request: DatabaseSqlFetch): FetchKind {
  return match(request.query)
    .returnType<FetchKind>()
    .with({ type: 'soup' }, ({ keyHint }) =>
      keyHint ? 'relation page' : 'table page'
    )
    .with({ type: 'people' }, () => 'people page')
    .with({ type: 'groupSoup' }, () => 'bins')
    .exhaustive();
}

function fetchTable(request: DatabaseSqlFetch): string | null {
  return match(request.query)
    .with({ type: 'soup' }, { type: 'groupSoup' }, ({ table }) => table)
    .with({ type: 'people' }, () => null)
    .exhaustive();
}

function hintCount(request: DatabaseSqlFetch): number {
  return match(request.query)
    .with({ type: 'soup' }, ({ keyHint }) => keyHint?.values.length ?? 0)
    .with({ type: 'people' }, ({ ids }) => ids?.length ?? 0)
    .with({ type: 'groupSoup' }, () => 0)
    .exhaustive();
}

/** The closed group's one line: what ran, how it ended, and how long it took. */
export function runHeadline(
  subject: DatabaseSqlSubject,
  outcome: { rows: number; truncated: boolean } | { error: string },
  fetches: number,
  milliseconds: number
): string {
  const what = match(subject)
    .with({ kind: 'sql' }, { kind: 'check' }, ({ kind, sql }) => {
      const [first = ''] = sql.trim().split('\n');
      const line = first.length > 80 ? `${first.slice(0, 80)}…` : first;
      return kind === 'check' ? `check ${line}` : line;
    })
    .with({ kind: 'view' }, ({ view }) => `view “${view.name}”`)
    .exhaustive();
  const ended =
    'error' in outcome
      ? `failed (${outcome.error})`
      : `${outcome.rows} rows${outcome.truncated ? ' (truncated)' : ''}`;
  return `${PREFIX} ${what} · ${ended} · ${fetches} fetches · ${Math.round(milliseconds)}ms`;
}

function subjectAttributes(span: Span, subject: DatabaseSqlSubject) {
  span.setAttr('database_sql.statement_kind', subject.kind);
  match(subject)
    .with({ kind: 'sql' }, { kind: 'check' }, ({ sql }) =>
      span.setAttr('database_sql.sql', sql.slice(0, SQL_ATTRIBUTE_LENGTH))
    )
    .with({ kind: 'view' }, ({ view }) => {
      span.setAttr('database_sql.view_id', view.id);
      span.setAttr('database_sql.table_id', view.tableId);
      span.setAttr('database_sql.view_name', view.name);
    })
    .exhaustive();
}

function logSubject(subject: DatabaseSqlSubject, catalog: Catalog) {
  match(subject)
    .with({ kind: 'sql' }, { kind: 'check' }, ({ sql }) =>
      console.log('statement', sql)
    )
    .with({ kind: 'view' }, ({ view }) =>
      console.log('view', {
        id: view.id,
        name: view.name,
        table: view.tableId,
        query: view.query,
      })
    )
    .exhaustive();
  console.log('scope', {
    databases: [...new Set(catalog.tables.map((table) => table.database))],
    tables: catalog.tables.map((table) => `${table.name} (${table.id})`),
  });
}

function logStep(step: DatabaseSqlStepRecord, tableNames: Map<string, string>) {
  const table = step.table ? (tableNames.get(step.table) ?? step.table) : '';
  const ended = step.error ? `failed: ${step.error}` : `${step.rows} rows`;
  console.log(
    `${step.kind}${table ? ` · ${table}` : ''} · page ${step.page} · ${ended} · ${Math.round(step.milliseconds)}ms`,
    {
      table: step.table,
      cursor: step.cursor,
      keyHints: step.hints,
      requests: step.requests,
      ...(step.foldMilliseconds === undefined
        ? {}
        : { foldMilliseconds: Math.round(step.foldMilliseconds) }),
    }
  );
}

/**
 * Run `drive` inside a `database_sql.run` span, giving it a trace whose
 * fetches and folds are child spans, then log the run as one group.
 */
export function traceDatabaseSqlRun<
  Failure extends { kind: string; error?: RunError },
>(
  subject: DatabaseSqlSubject,
  catalog: Catalog,
  drive: (trace: DatabaseSqlRunTrace) => ResultAsync<Outcome, Failure>,
  context?: DatabaseSqlReadContext
): ResultAsync<Outcome, Failure> {
  const started = performance.now();
  const runSpan = Telemetry.span('database_sql.run');
  subjectAttributes(runSpan, subject);
  if (context) {
    runSpan.setAttr('database_sql.read_reason', context.reason);
    runSpan.setAttr('database_sql.request_policy', context.requestPolicy);
    if (context.scope) runSpan.setAttr('database_sql.scope_id', context.scope);
  }
  runSpan.setAttr(
    'database_sql.database_ids',
    [...new Set(catalog.tables.map((table) => table.databaseId))].join(',')
  );
  runSpan.setAttr(
    'database_sql.table_ids',
    catalog.tables.map((table) => table.id).join(',')
  );
  const steps: DatabaseSqlStepRecord[] = [];
  const pages = new Map<string, number>();
  const trace: DatabaseSqlRunTrace = {
    async open(operation) {
      const span = runSpan.span('database_sql.engine.open');
      try {
        return await span.run(operation);
      } finally {
        span.end();
      }
    },
    start(operation) {
      return profileDatabasePhase(
        runSpan.span('database_sql.engine.start'),
        operation
      );
    },
    fetch(request, read, count) {
      const kind = fetchKind(request);
      const table = fetchTable(request);
      const pageKey = `${kind}:${table}`;
      const page = (pages.get(pageKey) ?? 0) + 1;
      pages.set(pageKey, page);
      const step: DatabaseSqlStepRecord = {
        kind,
        table,
        page,
        hints: hintCount(request),
        cursor: request.cursor,
        requests: [],
        milliseconds: 0,
      };
      steps.push(step);
      const stepStarted = performance.now();
      const span = runSpan.span('database_sql.fetch');
      span.setAttr('database_sql.request_kind', kind);
      if (table) span.setAttr('database_sql.table', table);
      span.setAttr('database_sql.page', page);
      span.setAttr('database_sql.hint_count', step.hints);
      const stepTrace: DatabaseSqlStepTrace = {
        decode(rows, operation) {
          const decodeSpan = span.span('database_sql.rows.decode');
          decodeSpan.setAttr('database_sql.rows', rows);
          return profileDatabasePhase(decodeSpan, operation);
        },
        request: (document, variables) =>
          step.requests.push({ document, variables }),
        headers: () => {
          const headers: Record<string, string> = {};
          span.injectTraceHeaders(headers);
          return headers;
        },
      };
      const settle = () => {
        step.milliseconds = performance.now() - stepStarted;
        span.end();
      };
      return span
        .run(() => read(stepTrace))
        .map((value) => {
          step.rows = count(value);
          span.setAttr('database_sql.rows', step.rows);
          settle();
          return value;
        })
        .mapErr((failure) => {
          step.error = JSON.stringify(failure);
          span.error(step.error);
          settle();
          return failure;
        });
    },
    fold(feed) {
      const foldStarted = performance.now();
      const span = runSpan.span('database_sql.fold');
      const fed = span.run(feed);
      if (fed.isErr()) span.error(JSON.stringify(fed.error));
      span.end();
      const last = steps.at(-1);
      if (last) last.foldMilliseconds = performance.now() - foldStarted;
      return fed;
    },
  };
  const tableNames = new Map(
    catalog.tables.map((table) => [table.id, table.name])
  );
  const finish = (
    outcome: { rows: number; truncated: boolean } | { error: string },
    detail: unknown
  ) => {
    const milliseconds = performance.now() - started;
    runSpan.setAttr('database_sql.fetch_count', steps.length);
    runSpan.setAttr(
      'database_sql.fetched_rows',
      steps.reduce((total, step) => total + (step.rows ?? 0), 0)
    );
    runSpan.setAttr(
      'database_sql.fetch_ms',
      steps.reduce((total, step) => total + step.milliseconds, 0)
    );
    runSpan.setAttr(
      'database_sql.fold_ms',
      steps.reduce((total, step) => total + (step.foldMilliseconds ?? 0), 0)
    );
    console.groupCollapsed(
      runHeadline(subject, outcome, steps.length, milliseconds)
    );
    logSubject(subject, catalog);
    for (const step of steps) logStep(step, tableNames);
    console.log('error' in outcome ? 'error' : 'outcome', detail);
    console.log(`total ${Math.round(milliseconds)}ms`);
    console.groupEnd();
    runSpan.end();
  };
  return runSpan
    .run(() => drive(trace))
    .andTee((outcome) => {
      runSpan.setAttr('database_sql.row_count', outcome.rows.length);
      runSpan.setAttr('database_sql.truncated', outcome.truncated);
      finish(
        { rows: outcome.rows.length, truncated: outcome.truncated },
        {
          columns: outcome.columns.map((column) => column.name),
          rows: outcome.rows.length,
          truncated: outcome.truncated,
        }
      );
    })
    .orTee((failure) => {
      const engineError = failure.error;
      const detail = {
        ...(engineError
          ? { 'database_sql.error_stage': engineError.stage }
          : {}),
        ...(engineError?.stage === 'resolve' || engineError?.stage === 'view'
          ? { 'database_sql.error_code': engineError.kind }
          : {}),
      };
      for (const [key, value] of Object.entries(detail))
        runSpan.setAttr(key, value);
      runSpan.setAttr('database_sql.error_kind', failure.kind);
      runSpan.error(JSON.stringify(failure));
      // Error messages may contain SQL literals or cell values. The error kind
      // and target IDs locate the failed trace without exporting that content.
      if (context && context.reportFailure !== false)
        runSpan.run(() =>
          Telemetry.warn('database SQL read failed', {
            ...detail,
            'database_sql.error_kind': failure.kind,
            'database_sql.read_reason': context.reason,
            'database_sql.request_policy': context.requestPolicy,
            'database_sql.scope_id': context.scope ?? '',
            'database_sql.database_ids': [
              ...new Set(catalog.tables.map((table) => table.databaseId)),
            ].join(','),
            'database_sql.table_ids': catalog.tables
              .map((table) => table.id)
              .join(','),
          })
        );
      finish({ error: failure.kind }, failure);
    });
}

/** Post an ops batch inside a `database_sql.ops` span, and log it as one group. */
export function traceDatabaseOps<Value, Failure>(
  databaseId: string,
  ops: readonly { kind: string; change?: { kind: string } }[],
  apply: () => ResultAsync<Value, Failure>
): ResultAsync<Value, Failure> {
  const started = performance.now();
  const kinds = [
    ...new Set(
      ops.map((op) => (op.change ? `${op.kind}.${op.change.kind}` : op.kind))
    ),
  ];
  const span = Telemetry.span('database_sql.ops');
  span.setAttr('database_sql.database_id', databaseId);
  span.setAttr('database_sql.op_count', ops.length);
  span.setAttr('database_sql.op_kinds', kinds.join(','));
  const log = (ended: 'applied' | 'refused', answer: unknown) => {
    const milliseconds = Math.round(performance.now() - started);
    console.groupCollapsed(
      `${PREFIX} ops ×${ops.length} (${kinds.join(', ')}) · ${ended} · ${milliseconds}ms`
    );
    console.log('database', databaseId);
    console.log('ops', ops);
    console.log(ended === 'applied' ? 'results' : 'error', answer);
    console.groupEnd();
    span.end();
  };
  return span
    .run(apply)
    .andTee((answer) => log('applied', answer))
    .orTee((failure) => {
      span.error(JSON.stringify(failure));
      log('refused', failure);
    });
}
