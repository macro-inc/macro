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
import { buildDatabaseSqlCatalog } from '@core/database-sql/wasm-module';
import { idToDisplayName, idToEmail } from '@core/user/util';
import type { CacheHost } from '@graphql-cache/host/types';
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
  capabilities: Pick<DatabaseSqlQueryCapabilities, 'open' | 'openView'>
): ResultAsync<Outcome, DatabaseSqlFailure> {
  if (statement.view)
    return runDatabaseView(catalog, statement.view, {
      source,
      ...(capabilities.openView ? { open: capabilities.openView } : {}),
    });
  return runDatabaseSql(catalog, statement.sql, {
    source,
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
  refresh: () => ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>;
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
    options: { reportFailure?: boolean; keepLoading?: boolean } = {}
  ): ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> => {
    const generation = ++latest;
    const host = capabilities.cacheHost();
    setLoading(true);
    const answered = statementCatalog(current, capabilities)
      .andThen((built) =>
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
          capabilities
        ).map((answer): DatabaseSqlRun => {
          if (generation !== latest) return { landed: false };
          // A cache change that left the answer alone keeps the same outcome.
          batch(() => {
            if (JSON.stringify(untrack(catalog)) !== JSON.stringify(built))
              setCatalog(built);
            if (JSON.stringify(untrack(outcome)) !== JSON.stringify(answer))
              setOutcome(answer);
            setError(undefined);
          });
          return { landed: true };
        })
      )
      .orElse((failure) => {
        if (generation !== latest) return okAsync({ landed: false });
        if (options.reportFailure !== false) setError(failure);
        return errAsync(failure);
      });
    const settle = async () => {
      const result = await answered;
      if (generation === latest && !options.keepLoading) setLoading(false);
      return result;
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

  function openStatement(current: DatabaseSqlStatement): void {
    if (!capabilities.cacheHost()) {
      void trackNetwork(run(current, 'cache-and-network', false));
      return;
    }
    // Only a complete cached answer is shown. A miss still reads the network.
    const cached = run(current, 'cache-only', false, {
      reportFailure: false,
      keepLoading: true,
    });
    const generation = latest;
    const reconcile = async () => {
      await cached;
      if (generation !== latest) return ok({ landed: false });
      return await run(current, 'network-only', false);
    };
    void trackNetwork(new ResultAsync(reconcile()));
  }

  createEffect(
    on(statement, (current) => {
      baselines = new Map();
      latest += 1;
      setError(undefined);
      setLoading(false);
      if (!current) {
        batch(() => {
          setOutcome(undefined);
          setCatalog(undefined);
        });
        return;
      }
      openStatement(current);
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
        if (current) await run(current, 'cache-first', true);
      })
    );
  });

  onCleanup(() => {
    latest += 1;
  });

  return {
    outcome,
    catalog,
    error,
    loading,
    refresh: () => {
      const current = untrack(statement);
      if (!current) return okAsync({ landed: false });
      return trackNetwork(run(current, 'network-only', false));
    },
    cached: () => capabilities.cacheHost() !== undefined,
    answerFromCache: () => {
      const current = untrack(statement);
      if (!current) return okAsync({ landed: false });
      return run(current, 'cache-first', true);
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
  capabilities: DatabaseSqlQueryCapabilities = productionDatabaseSqlCapabilities()
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
      capabilities
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
