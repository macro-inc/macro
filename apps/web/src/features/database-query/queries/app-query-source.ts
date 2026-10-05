import type { TModel } from '@core/component/AI/constant';
import { databaseSqlAnswer } from '@core/database-sql/answer';
import { databaseSqlSchema } from '@core/database-sql/catalog';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  checkDatabaseSql,
  readDatabaseSql,
} from '@queries/database-sql/create-database-sql-query';
import {
  createSavedDatabaseQuery,
  useDatabaseQueryDefinition,
} from '@queries/storage/database-queries';
import {
  fetchViewerDatabases,
  useViewerDatabases,
} from '@queries/storage/databases';
import { useDatabaseTableChanges } from '@queries/storage/databases-sync';
import { databasesKeys } from '@queries/storage/keys';
import { useEntitySubscription } from '@service-connection/client';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import type { QueryCapabilities } from '../context/query-context';
import {
  generationFailure,
  parseQueryProposal,
  type QueryFailure,
  type QueryProposal,
  serviceError,
  thrownServiceError,
} from '../core/query';
import { createLiveQuerySource, type LiveQuerySource } from './query-source';
import { createQuestionCapabilities } from './question-capabilities';

const databasesFailure = (thrown: unknown): QueryFailure => ({
  kind: 'databases',
  error: thrownServiceError(thrown),
});

function viewerDatabases(): ResultAsync<DatabaseDetail[], QueryFailure> {
  return fetchViewerDatabases().mapErr(
    (errors): QueryFailure => ({
      kind: 'databases',
      error: serviceError(errors),
    })
  );
}

function generateDatabaseQuery(
  input: Parameters<QueryCapabilities['generate']>[0],
  model: TModel
): ResultAsync<QueryProposal, QueryFailure> {
  return ResultAsync.fromPromise(
    import('@service-cognition/database-query'),
    (thrown) =>
      generationFailure(
        thrown instanceof Error ? thrown.message : String(thrown)
      )
  )
    .andThen((cognition) =>
      cognition.generateDatabaseQuery(input, model).mapErr((failure) =>
        generationFailure(
          match(failure)
            .with(
              { kind: 'service' },
              ({ errors }) => serviceError(errors).message
            )
            .with({ kind: 'interrupted' }, ({ reason }) => reason)
            .exhaustive()
        )
      )
    )
    .andThen(parseQueryProposal);
}

/** Production transport adapters; the composer only receives these narrow capabilities. */
export function createQueryCapabilities(
  model: Accessor<TModel>
): QueryCapabilities {
  return createQuestionCapabilities({
    generate: (input) => generateDatabaseQuery(input, model()),
    // A draft question may read any database the viewer can reach.
    read: (sql) =>
      viewerDatabases().andThen((databases) =>
        readDatabaseSql({ schema: databaseSqlSchema(databases), sql }).map(
          ({ catalog, outcome }) =>
            databaseSqlAnswer(outcome, catalog, databases)
        )
      ),
    describe: (databaseId) =>
      ResultAsync.fromPromise(
        queryClient.fetchQuery({
          queryKey: databasesKeys.detail(databaseId).queryKey,
          queryFn: () =>
            throwOnErr(() =>
              storageServiceClient.databases.get({ id: databaseId })
            ),
          staleTime: 0,
        }),
        databasesFailure
      ),
  });
}

/** A saved question's live answer, run in the browser. */
export function createSavedQuestionSource(
  queryId: Accessor<string>
): LiveQuerySource {
  const definition = useDatabaseQueryDefinition(queryId);
  const viewer = useViewerDatabases();
  return createLiveQuerySource({
    statement: () =>
      definition.isSuccess
        ? {
            sql: definition.data.definition.query,
            databaseId: definition.data.databaseId ?? undefined,
          }
        : undefined,
    databases: viewer.databases,
    loadError: () => {
      if (definition.isError)
        return {
          kind: 'question',
          error: thrownServiceError(definition.error),
        };
      const failed = viewer.error();
      return failed === undefined || failed === null
        ? undefined
        : databasesFailure(failed);
    },
    subscribe: (onChange) =>
      useDatabaseTableChanges((change) => onChange(change.tableId)),
  });
}

/**
 * Saved queries are immutable: every new SQL text becomes a new row. The
 * service stores it as given, so it is compiled against the viewer's
 * catalog first, and only a read is saved.
 */
export function saveQuestionSql(input: {
  sql: string;
  databaseId?: string;
}): ResultAsync<string, QueryFailure> {
  return viewerDatabases()
    .andThen((databases) =>
      checkDatabaseSql({
        schema: databaseSqlSchema(databases),
        scope: input.databaseId,
        sql: input.sql,
      })
    )
    .andThen(() =>
      createSavedDatabaseQuery({
        definition: { version: 1, query: input.sql },
        ...(input.databaseId ? { databaseId: input.databaseId } : {}),
      }).mapErr(
        (errors): QueryFailure => ({
          kind: 'question',
          error: serviceError(errors),
        })
      )
    )
    .map((saved) => saved.id);
}

export function trackQueryDatabase(id: string, onRefresh: () => void) {
  useEntitySubscription(
    () => ({ entity_type: 'database', entity_id: id }),
    onRefresh
  );
}
