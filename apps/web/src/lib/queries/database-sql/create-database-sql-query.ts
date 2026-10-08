/**
 * A live SQL statement run in the browser over the GraphQL row source, rerun from the
 * cache whenever it changes; a changed statement keeps the last answer until its own arrives.
 */

import {
  checkReadStatement,
  type DatabaseSqlFailure,
  engineFailure,
  type OpenEngine,
  type OpenView,
  type RowSource,
  runDatabaseSql,
  runDatabaseView,
} from '@core/database-sql/driver';
import type {
  Catalog,
  DatabaseView,
  Outcome,
  Schema,
} from '@core/database-sql/generated/types';
import {
  profileDatabasePhase,
  traceDatabaseFrame,
} from '@core/database-sql/profile';
import type {
  DatabaseSqlReadContext,
  DatabaseSqlReadReason,
} from '@core/database-sql/trace';
import { buildDatabaseSqlCatalog } from '@core/database-sql/wasm-module';
import { idToDisplayName, idToEmail } from '@core/user/util';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { contactsQueryOptions } from '@queries/contacts/contacts';
import { subscribeToVisibleCacheChanges } from '@queries/subscribe-to-visible-cache-changes';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import type { Client, RequestPolicy } from '@urql/core';
import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  createGraphqlRowSource,
  type LocalMembership,
  type Person,
} from './graphql-source';

/** A statement, or a view's rows, and the databases its catalog is built from. */
export type DatabaseSqlStatement = {
  schema: Schema;
  /** The database the statement is written from: its tables win name ties. */
  scope?: string;
} & ({ sql: string; view?: never } | { view: DatabaseView; sql?: never });

/** Equal statements answer alike, so a rebuilt but unchanged one need not rerun. */
export function sameDatabaseSqlStatement(
  left: DatabaseSqlStatement | undefined,
  right: DatabaseSqlStatement | undefined
): boolean {
  return (
    left?.sql === right?.sql &&
    left?.scope === right?.scope &&
    JSON.stringify(left?.view) === JSON.stringify(right?.view) &&
    JSON.stringify(left?.schema) === JSON.stringify(right?.schema)
  );
}

/** Builds a statement's catalog; the wasm engine unless a test says otherwise. */
type BuildCatalog = (schema: Schema, scope?: string) => Promise<Catalog>;

export interface DatabaseSqlQueryCapabilities {
  client: () => Client;
  cacheHost: () =>
    | Pick<CacheHost, 'onCacheChanged' | 'entityFilter' | 'readRecordsByKeys'>
    | undefined;
  people: () => Promise<Person[]>;
  /** The engine; the wasm module unless a test says otherwise. */
  open?: OpenEngine;
  openView?: OpenView;
  catalog?: BuildCatalog;
}

function statementCatalog(
  statement: DatabaseSqlStatement,
  capabilities: Pick<DatabaseSqlQueryCapabilities, 'catalog'>
): ResultAsync<Catalog, DatabaseSqlFailure> {
  return ResultAsync.fromPromise(
    (capabilities.catalog ?? buildDatabaseSqlCatalog)(
      statement.schema,
      statement.scope
    ),
    engineFailure
  );
}

/** Run a statement, or a view's compiled query, over `source`. */
function runStatement(
  catalog: Catalog,
  statement: DatabaseSqlStatement,
  source: RowSource,
  capabilities: Pick<DatabaseSqlQueryCapabilities, 'open' | 'openView'>,
  context: DatabaseSqlReadContext,
  signal?: AbortSignal
): ResultAsync<Outcome, DatabaseSqlFailure> {
  if (statement.view)
    return runDatabaseView(catalog, statement.view, {
      source,
      context,
      signal,
      ...(capabilities.openView ? { open: capabilities.openView } : {}),
    });
  return runDatabaseSql(catalog, statement.sql, {
    source,
    context,
    signal,
    ...(capabilities.open ? { open: capabilities.open } : {}),
  });
}

/** Whether a run's answer is the one shown; a later run, or a changed statement, replaces it. */
export type DatabaseSqlRun = { landed: boolean };

export interface DatabaseSqlQuery {
  /** The last answer; kept while a later run, of this statement or a changed one, is in flight. */
  outcome: Accessor<Outcome | undefined>;
  /** The catalog the last answer was read against. */
  catalog: Accessor<Catalog | undefined>;
  /** Why the last run failed, until one succeeds. */
  error: Accessor<DatabaseSqlFailure | undefined>;
  loading: Accessor<boolean>;
  /** Read the statement's tables from the server again. */
  refresh: (
    reason?: DatabaseSqlReadReason
  ) => ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>;
  /** Whether a local cache backs the reads, so rows read into it can answer the statement. */
  cached: () => boolean;
  /** Answer the statement again from the local cache, as a cache change would, without waiting on one. */
  answerFromCache: () => ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>;
}

/** The app's GraphQL client and cache, and the contacts query for people. */
function productionDatabaseSqlCapabilities(): DatabaseSqlQueryCapabilities {
  return {
    client: getGraphqlSoupClient,
    cacheHost: getGraphqlSoupCacheHost,
    people: async () => {
      const { contacts } = await queryClient.fetchQuery(contactsQueryOptions());
      return contacts.map((id) => ({
        id,
        name: idToDisplayName(id),
        email: idToEmail(id),
      }));
    },
  };
}

export function createDatabaseSqlQuery(
  statement: Accessor<DatabaseSqlStatement | undefined>,
  capabilities: DatabaseSqlQueryCapabilities = productionDatabaseSqlCapabilities()
): DatabaseSqlQuery {
  const [outcome, setOutcome] = createSignal<Outcome>();
  const [catalog, setCatalog] = createSignal<Catalog>();
  const [error, setError] = createSignal<DatabaseSqlFailure>();
  const [loading, setLoading] = createSignal(false);
  let latest = 0;
  let activeRead: AbortController | undefined;
  let cancelFrame: (() => void) | undefined;
  // The cache may not hold what an in-flight network read will bring, so a
  // cache change waits for it instead of answering from older rows.
  let networkRead: ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> | undefined;
  // First-page evidence for the local filter index, per statement.
  let baselines: LocalMembership['baselines'] = new Map();

  /** Fails with this run's failure, unless a later run replaced it. */
  const run = (
    current: DatabaseSqlStatement,
    requestPolicy: RequestPolicy,
    reconcile: boolean,
    reason: DatabaseSqlReadReason,
    options: { reportFailure?: boolean; keepLoading?: boolean } = {}
  ): ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> => {
    const generation = ++latest;
    activeRead?.abort();
    const controller = new AbortController();
    activeRead = controller;
    const querySpan = Telemetry.span('database_sql.query');
    querySpan.setAttr('database_sql.read_reason', reason);
    querySpan.setAttr('database_sql.request_policy', requestPolicy);
    if (current.scope)
      querySpan.setAttr('database_sql.scope_id', current.scope);
    if (current.view)
      querySpan.setAttr('database_sql.table_id', current.view.tableId);
    const catalogSpan = querySpan.span('database_sql.catalog');
    const host = capabilities.cacheHost();
    setLoading(true);
    const answered = catalogSpan
      .run(() => statementCatalog(current, capabilities))
      .andTee(() => catalogSpan.end())
      .orTee(() => catalogSpan.end())
      .andThen((built) =>
        querySpan
          .run(() =>
            runStatement(
              built,
              current,
              createGraphqlRowSource({
                client: capabilities.client(),
                catalog: built,
                requestPolicy,
                people: capabilities.people,
                membership: host ? { host, baselines, reconcile } : undefined,
              }),
              capabilities,
              {
                reason,
                scope: current.scope,
                requestPolicy,
                reportFailure: options.reportFailure,
              },
              controller.signal
            )
          )
          .map((answer): DatabaseSqlRun => {
            if (generation !== latest) return { landed: false };
            // A cache change that left the answer alone keeps the same outcome.
            querySpan.setAttr('database_sql.row_count', answer.rows.length);
            querySpan.setAttr('database_sql.truncated', answer.truncated);
            const changed = profileDatabasePhase(
              querySpan.span('database_sql.compare'),
              () => ({
                catalog:
                  JSON.stringify(untrack(catalog)) !== JSON.stringify(built),
                outcome:
                  JSON.stringify(untrack(outcome)) !== JSON.stringify(answer),
              })
            );
            querySpan.setAttr(
              'database_sql.result_changed',
              changed.catalog || changed.outcome
            );
            const publishSpan = querySpan.span('database_sql.publish');
            profileDatabasePhase(publishSpan, () =>
              batch(() => {
                if (changed.catalog) setCatalog(built);
                if (changed.outcome) setOutcome(answer);
                setError(undefined);
              })
            );
            if (changed.catalog || changed.outcome) {
              cancelFrame?.();
              cancelFrame = traceDatabaseFrame(
                querySpan.span('database_sql.frame')
              );
            }
            return { landed: true };
          })
      )
      .orElse((failure) => {
        if (generation !== latest) return okAsync({ landed: false });
        if (options.reportFailure !== false) setError(failure);
        return errAsync(failure);
      });
    const settle = async () => {
      try {
        const result = await answered;
        if (generation === latest && !options.keepLoading) setLoading(false);
        querySpan.setAttr(
          'database_sql.outcome',
          result.isErr()
            ? 'error'
            : result.value.landed
              ? 'published'
              : 'superseded'
        );
        return result;
      } finally {
        if (activeRead === controller) activeRead = undefined;
        querySpan.end();
      }
    };
    return new ResultAsync(settle());
  };

  function trackNetwork(
    reading: ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>
  ): ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> {
    networkRead = reading;
    const settle = async () => {
      const result = await reading;
      if (networkRead === reading) networkRead = undefined;
      return result;
    };
    return new ResultAsync(settle());
  }

  function openStatement(
    current: DatabaseSqlStatement,
    reason: DatabaseSqlReadReason
  ): void {
    if (!capabilities.cacheHost()) {
      void trackNetwork(run(current, 'cache-and-network', false, reason));
      return;
    }
    // Only a complete cached answer is shown. A miss still reads the network.
    const cached = run(current, 'cache-only', false, reason, {
      reportFailure: false,
      keepLoading: true,
    });
    const generation = latest;
    const reconcile = async () => {
      await cached;
      if (generation !== latest) return ok({ landed: false });
      return await run(current, 'network-only', false, reason);
    };
    void trackNetwork(new ResultAsync(reconcile()));
  }

  createEffect(
    on(statement, (current, previous) => {
      cancelFrame?.();
      baselines = new Map();
      latest += 1;
      activeRead?.abort();
      setError(undefined);
      setLoading(false);
      if (!current) {
        batch(() => {
          setOutcome(undefined);
          setCatalog(undefined);
        });
        return;
      }
      const reason = !previous
        ? 'initial'
        : JSON.stringify(previous.schema) !== JSON.stringify(current.schema)
          ? 'schema-change'
          : 'statement-change';
      openStatement(current, reason);
    })
  );

  // Rerun against the cache whenever it changes; the engine is cheap next to
  // a network read, and an unchanged cache answers the same rows.
  createEffect(() => {
    const host = capabilities.cacheHost();
    if (!host) return;
    onCleanup(
      subscribeToVisibleCacheChanges(host, async () => {
        if (networkRead) {
          await networkRead;
          return;
        }
        const current = untrack(statement);
        if (current) await run(current, 'cache-first', true, 'cache-change');
      })
    );
  });

  onCleanup(() => {
    cancelFrame?.();
    latest += 1;
    activeRead?.abort();
  });

  return {
    outcome,
    catalog,
    error,
    loading,
    refresh: (reason = 'refresh') => {
      const current = untrack(statement);
      if (!current) return okAsync({ landed: false });
      return trackNetwork(run(current, 'network-only', false, reason));
    },
    cached: () => capabilities.cacheHost() !== undefined,
    answerFromCache: () => {
      const current = untrack(statement);
      if (!current) return okAsync({ landed: false });
      return run(current, 'cache-first', true, 'cache-reconcile');
    },
  };
}

/** Refresh without waiting; a failure shows through the reader's own error. */
export function refreshInBackground(reader: {
  refresh: () => ResultAsync<unknown, unknown>;
}): void {
  void reader.refresh();
}

/** One read of a statement from the network, for an answer nothing keeps live. */
export function readDatabaseSql(
  statement: DatabaseSqlStatement,
  capabilities: DatabaseSqlQueryCapabilities = productionDatabaseSqlCapabilities(),
  reason: DatabaseSqlReadReason = 'read'
): ResultAsync<{ catalog: Catalog; outcome: Outcome }, DatabaseSqlFailure> {
  return statementCatalog(statement, capabilities).andThen((catalog) =>
    runStatement(
      catalog,
      statement,
      createGraphqlRowSource({
        client: capabilities.client(),
        catalog,
        requestPolicy: 'network-only',
        people: capabilities.people,
      }),
      capabilities,
      { reason, scope: statement.scope, requestPolicy: 'network-only' }
    ).map((outcome) => ({ catalog, outcome }))
  );
}

/** Compile and plan a statement against its catalog, reading nothing; a write is refused. */
export function checkDatabaseSql(
  statement: Extract<DatabaseSqlStatement, { sql: string }>,
  capabilities: Pick<DatabaseSqlQueryCapabilities, 'open' | 'catalog'> = {}
): ResultAsync<void, DatabaseSqlFailure> {
  return statementCatalog(statement, capabilities).andThen((catalog) =>
    checkReadStatement(
      catalog,
      statement.sql,
      capabilities.open ? { open: capabilities.open } : {}
    )
  );
}
