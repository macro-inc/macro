/** Live SQL reads: ordinary tables use the cache; people statements execute in
 * local Turso. No browser source can enumerate the personal directory. */
import {
  type DatabaseSqlFailure,
  engineFailure,
  type OpenEngine,
  type OpenView,
  runDatabaseSql,
  runDatabaseView,
} from '@core/database-sql/driver';
import type {
  Catalog,
  DatabaseView,
  Outcome,
  ReadDescription,
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
import {
  buildDatabaseSqlCatalog,
  describeDatabaseRead,
} from '@core/database-sql/wasm-module';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheChangeListener, CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import {
  currentQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
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
import { subscribeContactCheckpoint } from '../contacts/backfill';
import { createGraphqlRowSource, type LocalMembership } from './graphql-source';
import {
  createLocalSqlReader,
  type LocalPeopleSqlHost,
  type LocalSqlReader,
  localPeopleRows,
  type readLocalSql,
} from './local-read';

export type DatabaseSqlStatement = { schema: Schema; scope?: string } & (
  | { sql: string; view?: never }
  | { view: DatabaseView; sql?: never }
);
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
type BuildCatalog = (schema: Schema, scope?: string) => Promise<Catalog>;
export interface DatabaseSqlQueryCapabilities {
  account: Accessor<QueryAccount | undefined>;
  client: () => Client;
  cacheHost: () =>
    | Pick<
        CacheHost,
        'onCacheChanged' | 'entityFilter' | 'readRecordsByKeys' | 'readQuery'
      >
    | undefined;
  /** The local directory capability is independent of ordinary table reads. */
  localPeople?: () => LocalPeopleSqlHost | undefined;
  localRead?: typeof readLocalSql;
  open?: OpenEngine;
  openView?: OpenView;
  catalog?: BuildCatalog;
  describe?: typeof describeDatabaseRead;
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
function describeStatement(
  catalog: Catalog,
  statement: DatabaseSqlStatement,
  capabilities: Pick<DatabaseSqlQueryCapabilities, 'describe'>
) {
  const input = statement.view
    ? { view: statement.view }
    : { sql: statement.sql };
  return ResultAsync.fromPromise(
    (capabilities.describe ?? describeDatabaseRead)(catalog, input),
    engineFailure
  );
}
function readsPeople(catalog: Catalog, description: ReadDescription): boolean {
  return catalog.tables.some(
    (table) =>
      table.source === 'people' && description.readTables.includes(table.id)
  );
}
function sameAccount(
  left: QueryAccount | undefined,
  right: QueryAccount | undefined
): boolean {
  return left?.userId === right?.userId && left?.session === right?.session;
}

function runStatement(
  catalog: Catalog,
  statement: DatabaseSqlStatement,
  description: ReadDescription,
  capabilities: DatabaseSqlQueryCapabilities,
  account: QueryAccount,
  signal: AbortSignal,
  requestPolicy: RequestPolicy,
  membership: LocalMembership | undefined,
  context: DatabaseSqlReadContext,
  local: LocalSqlReader
): ResultAsync<Outcome | undefined, DatabaseSqlFailure> {
  if (signal.aborted || !sameAccount(account, capabilities.account()))
    return errAsync({
      kind: 'fetch',
      message: 'Query account changed or read canceled',
    });
  if (
    description.readTables.length === 1 &&
    readsPeople(catalog, description)
  ) {
    if (statement.view)
      return errAsync({
        kind: 'rejected',
        message: 'People views require a supported SQL statement',
      });
    return local.read(
      {
        account,
        host: capabilities.localPeople?.(),
        input: { kind: 'statement', sql: statement.sql },
        description,
      },
      signal
    );
  }
  const source = createGraphqlRowSource({
    client: capabilities.client(),
    catalog,
    requestPolicy,
    cache: capabilities.cacheHost(),
    membership,
    people: (ids) =>
      local
        .read(
          {
            account,
            host: capabilities.localPeople?.(),
            input: { kind: 'identities', ids },
          },
          signal
        )
        .andThen(localPeopleRows),
  });
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

export type DatabaseSqlRun = { landed: boolean };
export interface DatabaseSqlQuery {
  outcome: Accessor<Outcome | undefined>;
  catalog: Accessor<Catalog | undefined>;
  error: Accessor<DatabaseSqlFailure | undefined>;
  loading: Accessor<boolean>;
  refresh: (
    reason?: DatabaseSqlReadReason
  ) => ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>;
  cached: () => boolean;
  answerFromCache: () => ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>;
}

function productionDatabaseSqlCapabilities(
  account: Accessor<QueryAccount | undefined>
): DatabaseSqlQueryCapabilities {
  return {
    account: () => {
      account();
      return currentQueryAccount();
    },
    client: getGraphqlSoupClient,
    cacheHost: getGraphqlSoupCacheHost,
    localPeople: getGraphqlSoupCacheHost,
  };
}

export function createDatabaseSqlQuery(
  statement: Accessor<DatabaseSqlStatement | undefined>,
  supplied?: DatabaseSqlQueryCapabilities
): DatabaseSqlQuery {
  const capabilities =
    supplied ?? productionDatabaseSqlCapabilities(useQueryAccount());
  const [outcome, setOutcome] = createSignal<Outcome>();
  const [catalog, setCatalog] = createSignal<Catalog>();
  const [error, setError] = createSignal<DatabaseSqlFailure>();
  const [loading, setLoading] = createSignal(false);
  const [peopleOnly, setPeopleOnly] = createSignal<boolean>();
  const [hasPeople, setHasPeople] = createSignal(false);
  const local = createLocalSqlReader(capabilities.localRead);
  let latest = 0;
  let disposed = false;
  let scopeOwner = untrack(capabilities.account);
  let active: AbortController | undefined;
  let cancelFrame: (() => void) | undefined;
  let networkRead: ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> | undefined;
  let baselines: LocalMembership['baselines'] = new Map();

  const run = (
    current: DatabaseSqlStatement,
    requestPolicy: RequestPolicy,
    reconcile: boolean,
    reason: DatabaseSqlReadReason,
    options: {
      reportFailure?: boolean;
      keepLoading?: boolean;
      allowDisposed?: boolean;
    } = {}
  ): ResultAsync<DatabaseSqlRun, DatabaseSqlFailure> => {
    const generation = ++latest;
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const account = capabilities.account();
    if (
      !account ||
      (disposed &&
        (!options.allowDisposed || !sameAccount(account, scopeOwner)))
    )
      return okAsync({ landed: false });
    const valid = () =>
      (!disposed ||
        (options.allowDisposed && sameAccount(account, scopeOwner))) &&
      generation === latest &&
      !controller.signal.aborted &&
      sameAccount(account, capabilities.account());
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
        describeStatement(built, current, capabilities).andThen(
          (description) => {
            if (!valid())
              return okAsync<DatabaseSqlRun, DatabaseSqlFailure>({
                landed: false,
              });
            querySpan.setAttr(
              'database_sql.execution',
              description.readTables.length === 1 &&
                readsPeople(built, description)
                ? 'local-turso'
                : 'local-fold'
            );
            setHasPeople(readsPeople(built, description));
            setPeopleOnly(
              description.readTables.length === 1 &&
                readsPeople(built, description)
            );
            return querySpan
              .run(() =>
                runStatement(
                  built,
                  current,
                  description,
                  capabilities,
                  account,
                  controller.signal,
                  requestPolicy,
                  host ? { host, baselines, reconcile } : undefined,
                  {
                    reason,
                    scope: current.scope,
                    requestPolicy,
                    reportFailure: options.reportFailure,
                  },
                  local
                )
              )
              .map((answer): DatabaseSqlRun => {
                if (!answer || !valid()) return { landed: false };
                querySpan.setAttr('database_sql.row_count', answer.rows.length);
                querySpan.setAttr('database_sql.truncated', answer.truncated);
                const changed = profileDatabasePhase(
                  querySpan.span('database_sql.compare'),
                  () => ({
                    catalog:
                      JSON.stringify(untrack(catalog)) !==
                      JSON.stringify(built),
                    outcome:
                      JSON.stringify(untrack(outcome)) !==
                      JSON.stringify(answer),
                  })
                );
                querySpan.setAttr(
                  'database_sql.result_changed',
                  changed.catalog || changed.outcome
                );
                profileDatabasePhase(
                  querySpan.span('database_sql.publish'),
                  () =>
                    batch(() => {
                      if (changed.catalog) setCatalog(built);
                      if (changed.outcome) setOutcome(answer);
                      setError(undefined);
                    })
                );
                if (!disposed && (changed.catalog || changed.outcome)) {
                  cancelFrame?.();
                  cancelFrame = traceDatabaseFrame(
                    querySpan.span('database_sql.frame')
                  );
                }
                return { landed: true };
              });
          }
        )
      )
      .orElse((failure) => {
        if (!valid()) return okAsync({ landed: false });
        if (failure.kind === 'scope-changed')
          batch(() => {
            setOutcome(undefined);
            setCatalog(undefined);
          });
        if (options.reportFailure !== false) setError(failure);
        return errAsync(failure);
      });
    const settle = async () => {
      try {
        const result = await answered;
        if (valid() && !options.keepLoading) setLoading(false);
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
        if (active === controller) active = undefined;
        querySpan.end();
      }
    };
    return new ResultAsync(settle());
  };

  function trackNetwork(
    reading: ResultAsync<DatabaseSqlRun, DatabaseSqlFailure>
  ) {
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
  ) {
    if (!capabilities.cacheHost() && !capabilities.localPeople?.()) {
      fireAndForget(
        trackNetwork(run(current, 'cache-and-network', false, reason)),
        'database-sql'
      );
      return;
    }
    const cached = run(current, 'cache-only', false, reason, {
      reportFailure: false,
      keepLoading: true,
    });
    const generation = latest;
    const reconcile = async () => {
      const result = await cached;
      if (generation !== latest || disposed) return ok({ landed: false });
      if (peopleOnly()) {
        setLoading(false);
        if (result.isErr()) setError(result.error);
        return result;
      }
      return await run(current, 'network-only', false, reason);
    };
    fireAndForget(trackNetwork(new ResultAsync(reconcile())), 'database-sql');
  }

  createEffect(
    on(
      () => [statement(), capabilities.account()] as const,
      ([current, account], previous) => {
        scopeOwner = account;
        cancelFrame?.();
        active?.abort();
        latest += 1;
        baselines = new Map();
        networkRead = undefined;
        batch(() => {
          setError(undefined);
          setLoading(false);
          setPeopleOnly(undefined);
          setHasPeople(false);
          if (!current || !account || !sameAccount(account, previous?.[1])) {
            setOutcome(undefined);
            setCatalog(undefined);
          }
        });
        if (!current || !account) return;
        const prior = previous?.[0];
        const reason = !prior
          ? 'initial'
          : JSON.stringify(prior.schema) !== JSON.stringify(current.schema)
            ? 'schema-change'
            : 'statement-change';
        openStatement(current, reason);
      }
    )
  );
  createEffect(() => {
    const host = capabilities.cacheHost();
    const people = hasPeople();
    if (!host) return;
    let observing = true;
    onCleanup(() => {
      observing = false;
    });
    const refresh = async () => {
      if (networkRead) {
        const generation = latest;
        await networkRead;
        // Refresh a people snapshot once after an intervening commit;
        // ordinary reads retain their existing hydration reconciliation.
        if (!people || !observing || generation !== latest) return;
      }
      if (!observing || disposed) return;
      const current = untrack(statement);
      if (current)
        await trackNetwork(run(current, 'cache-first', true, 'cache-change'));
    };
    const changes: Pick<CacheHost, 'onCacheChanged'> = people
      ? {
          onCacheChanged(listener) {
            let previous: Parameters<CacheChangeListener>[0] | undefined;
            const notify: CacheChangeListener = (revision, changes) => {
              if (revision === previous) return;
              previous = revision;
              listener(revision, changes);
            };
            const committed = host.onCacheChanged(notify, {
              includeHydration: false,
            });
            const hydrated = host.onCacheChanged(
              (revision, changes) => {
                if (
                  changes?.searchChangedBuckets &&
                  !changes.searchChangedBuckets.includes('person')
                )
                  return;
                notify(revision, changes);
              },
              { includeHydration: true }
            );
            return () => {
              committed();
              hydrated();
            };
          },
        }
      : host;
    onCleanup(subscribeToVisibleCacheChanges(changes, refresh));
  });
  let previousPeopleHost = untrack(() => capabilities.localPeople?.());
  createEffect(() => {
    const host = capabilities.localPeople?.();
    const reset = () => {
      active?.abort();
      latest += 1;
      baselines = new Map();
      batch(() => {
        setOutcome(undefined);
        setCatalog(undefined);
        setError(undefined);
      });
      const current = untrack(statement);
      if (current && capabilities.account() && !disposed)
        openStatement(current, 'cache-change');
    };
    if (host !== previousPeopleHost) {
      previousPeopleHost = host;
      reset();
    }
    if (host) onCleanup(host.onCacheGenerationChanged(reset));
  });
  createEffect(() => {
    const account = capabilities.account();
    if (!account) return;
    onCleanup(
      subscribeContactCheckpoint(account.userId, () => {
        if (
          disposed ||
          !untrack(hasPeople) ||
          !sameAccount(account, capabilities.account())
        )
          return;
        const current = untrack(statement);
        if (current)
          fireAndForget(
            trackNetwork(run(current, 'cache-first', true, 'cache-change')),
            'local-sql-readiness'
          );
      })
    );
  });
  onCleanup(() => {
    disposed = true;
    local.dispose();
    active?.abort();
    cancelFrame?.();
    latest += 1;
  });
  return {
    outcome,
    catalog,
    error,
    loading,
    refresh: (reason = 'refresh') => {
      const current = untrack(statement);
      return current
        ? trackNetwork(
            run(current, 'network-only', false, reason, { allowDisposed: true })
          )
        : okAsync({ landed: false });
    },
    cached: () =>
      peopleOnly()
        ? !!capabilities.localPeople?.()
        : capabilities.cacheHost() !== undefined,
    answerFromCache: () => {
      const current = untrack(statement);
      return current
        ? run(current, 'cache-first', true, 'cache-reconcile', {
            allowDisposed: true,
          })
        : okAsync({ landed: false });
    },
  };
}

export function refreshInBackground(reader: {
  refresh: () => ResultAsync<unknown, unknown>;
}): void {
  fireAndForget(reader.refresh(), 'database-sql');
}

export function readDatabaseSql(
  statement: DatabaseSqlStatement,
  capabilities: DatabaseSqlQueryCapabilities = productionDatabaseSqlCapabilities(
    currentQueryAccount
  ),
  reason: DatabaseSqlReadReason = 'read'
): ResultAsync<{ catalog: Catalog; outcome: Outcome }, DatabaseSqlFailure> {
  const account = capabilities.account();
  if (!account)
    return errAsync({
      kind: 'fetch',
      message: 'Database reads require authentication',
    });
  const signal = new AbortController().signal;
  const local = createLocalSqlReader(capabilities.localRead);
  return statementCatalog(statement, capabilities)
    .andThen((catalog) =>
      describeStatement(catalog, statement, capabilities).andThen(
        (description) =>
          runStatement(
            catalog,
            statement,
            description,
            capabilities,
            account,
            signal,
            'network-only',
            undefined,
            { reason, scope: statement.scope, requestPolicy: 'network-only' },
            local
          ).andThen(
            (
              outcome
            ): ResultAsync<
              { catalog: Catalog; outcome: Outcome },
              DatabaseSqlFailure
            > =>
              outcome && sameAccount(account, capabilities.account())
                ? okAsync({ catalog, outcome })
                : errAsync({
                    kind: 'fetch',
                    message: 'Query account changed or read canceled',
                  })
          )
      )
    )
    .andTee(() => local.dispose())
    .orTee(() => local.dispose());
}

/** Validate with the compiler, without invoking any data source or RPC. */
export function checkDatabaseSql(
  statement: Extract<DatabaseSqlStatement, { sql: string }>,
  capabilities: Pick<DatabaseSqlQueryCapabilities, 'catalog' | 'describe'> = {}
): ResultAsync<void, DatabaseSqlFailure> {
  return statementCatalog(statement, capabilities)
    .andThen((catalog) => describeStatement(catalog, statement, capabilities))
    .map(() => undefined);
}
