import { handleAiUsageLimitError } from '@app/features/paywall/ai-usage-limit-handling';
import type { TModel } from '@core/component/AI/constant';
import { databaseSqlAnswer } from '@core/database-sql/answer';
import { databaseSqlSchema } from '@core/database-sql/catalog';
import { Telemetry } from '@macro-inc/observability';
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
  databaseDetailQueryOptions,
  fetchViewerDatabases,
  useViewerDatabases,
} from '@queries/storage/databases';
import { useDatabaseTableChanges } from '@queries/storage/databases-sync';
import { useEntitySubscription } from '@service-connection/client';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
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
      cognition.generateDatabaseQuery(input, model).mapErr((failure) => {
        handleAiUsageLimitError(failure.errors);
        return generationFailure(serviceError(failure.errors).message);
      })
    )
    .andThen(parseQueryProposal);
}

/** Phase summaries remain visible in DevTools even when browser export is disabled. */
function traceQueryPhase<T>(
  phase: 'generate' | 'read' | 'catalog',
  work: () => ResultAsync<T, QueryFailure>,
  attributes: Record<string, string | number | boolean> = {}
): ResultAsync<T, QueryFailure> {
  const span = Telemetry.span(`database.query.${phase}`);
  for (const [key, value] of Object.entries(attributes))
    span.setAttr(key, value);
  const started = performance.now();
  const settle = async () => {
    let outcome = 'error';
    try {
      const result = await span.run(work);
      outcome = result.isOk() ? 'success' : result.error.kind;
      span.setAttr('database.outcome', outcome);
      if (result.isErr()) span.error(result.error.kind);
      return result;
    } finally {
      const milliseconds = Math.round(performance.now() - started);
      console.info(
        `[database-query] ${phase} · ${outcome} · ${milliseconds}ms`,
        attributes
      );
      span.setAttr('database.duration_ms', milliseconds);
      span.end();
    }
  };
  return new ResultAsync(settle());
}

/** Production transport adapters; the composer only receives these narrow capabilities. */
export function createQueryCapabilities(
  model: Accessor<TModel>
): QueryCapabilities {
  return createQuestionCapabilities({
    generate: (input) => {
      const selectedModel = model();
      return traceQueryPhase(
        'generate',
        () => generateDatabaseQuery(input, selectedModel),
        {
          'database.model': selectedModel,
          'database.source_mode': input.schema.databaseId
            ? 'selected'
            : 'automatic',
          'database.table_count': input.schema.tables.length,
          'database.repair': !!input.error,
          ...(input.schema.databaseId
            ? { 'database.id': input.schema.databaseId }
            : {}),
        }
      );
    },
    // A draft question may read any database the viewer can reach.
    read: (sql, context) =>
      traceQueryPhase('read', () =>
        traceQueryPhase('catalog', viewerDatabases).andThen((databases) =>
          readDatabaseSql({
            schema: databaseSqlSchema(databases),
            sql,
            scope: context?.databaseId,
          }).map(({ catalog, outcome }) =>
            databaseSqlAnswer(outcome, catalog, databases)
          )
        )
      ),
    describe: (databaseId) =>
      ResultAsync.fromPromise(
        queryClient.fetchQuery({
          ...databaseDetailQueryOptions(databaseId),
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
