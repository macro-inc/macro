/**
 * Queries and mutations for the import pipeline.
 *
 * The server owns everything: Slack discovery and chat tools stage
 * candidates, `POST /import/run` accepts/declines them, and import jobs flip
 * rows to `imported`. Row flips are pushed over the connection gateway as
 * `import_updated`; polling remains as the backstop (pushes can be missed
 * while reconnecting), tightening while anything is in flight.
 */

import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type ImportEntity,
  type ImportSource,
  type ImportState,
  importClient,
  type NotionImportReport,
  type SlackChannelMeta,
} from '@service-cognition/import';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import {
  queryOptions,
  type UseMutationResult,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { importKeys } from './import/keys';

export type {
  ImportEntity,
  ImportEntityStatus,
  ImportKind,
  ImportRun,
  ImportRunStatus,
  ImportSource,
  ImportState,
  NotionImportReport,
  SlackChannelMeta,
} from '@service-cognition/import';

/** Gateway push sent when an import row or discovery run changes server-side. */
const IMPORT_UPDATED_MESSAGE_TYPE = 'import_updated';

/**
 * Stable empty aggregate served as `placeholderData` so this polling query
 * can never suspend (a query that has never succeeded would otherwise
 * re-suspend on every scheduled refetch and rhythmically blank whatever
 * Suspense boundary is above it).
 */
const PENDING_IMPORT_STATE: ImportState = { runs: [], entities: [] };

function anythingInFlight(state: ImportState | undefined): boolean {
  if (!state) return false;
  return (
    state.runs.some((run) => run.status === 'running') ||
    state.entities.some((entity) => entity.status === 'importing')
  );
}

function fetchImportStateFromServer() {
  return throwOnErr(() => importClient.getState());
}

// Cached on the query past unmount; module scope keeps hook state out of it.
function importStateQueryOptions() {
  return queryOptions({
    queryKey: importKeys.state.queryKey,
    queryFn: fetchImportStateFromServer,
    refetchInterval: (query) =>
      anythingInFlight(query.state.data) ? 3_000 : 15_000,
    placeholderData: PENDING_IMPORT_STATE,
  });
}

/** The import aggregate: discovery runs plus visible ledger rows. */
export function useImportQuery() {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== IMPORT_UPDATED_MESSAGE_TYPE) return;
    fireAndForget(invalidateImportState(), 'import-state');
  });

  return useQuery(() => importStateQueryOptions());
}

function invalidateImportState() {
  return queryClient.invalidateQueries({
    queryKey: importKeys.state.queryKey,
  });
}

/**
 * Accept and/or decline staged rows. The server flips accepted rows to
 * `importing` and returns immediately; completion arrives via
 * `import_updated` pushes and polling.
 */
export function useRunImportMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { importIds: string[]; discardIds: string[] }) =>
      throwOnErr(() =>
        importClient.runImport({
          import_ids: args.importIds,
          discard_ids: args.discardIds,
        })
      ),
    onSuccess: () => fireAndForget(invalidateImportState(), 'import-state'),
  }));
}

/** Discover candidates for manual selection. */
export function useDiscoverMutation(): UseMutationResult<
  void,
  Error,
  ImportSource
> {
  return useMutation(() => ({
    mutationFn: (source: ImportSource) =>
      throwOnErr(() => importClient.discover(source)),
    onSuccess: () => fireAndForget(invalidateImportState(), 'import-state'),
  }));
}

/** Slack channel metadata, only for Slack ledger rows. */
export function slackChannelMeta(
  entity: ImportEntity
): SlackChannelMeta | null {
  if (entity.source !== 'slack') return null;
  return entity.metadata as SlackChannelMeta;
}

function notionImportInFlight(report: NotionImportReport | undefined) {
  return report?.status === 'running' || report?.status === 'importing';
}

function fetchNotionReportFromServer() {
  return throwOnErr(() => importClient.getNotionReport());
}

// Cached on the query past unmount; module scope keeps hook state out of it.
function notionImportReportQueryOptions() {
  return queryOptions({
    queryKey: importKeys.notion.queryKey,
    queryFn: fetchNotionReportFromServer,
    // `import_updated` pushes drive refreshes; polling covers missed pushes
    // while the run is moving.
    refetchInterval: (query) =>
      notionImportInFlight(query.state.data) ? 2_000 : false,
  });
}

/** The Notion workspace import report, refreshed on `import_updated`. */
export function useNotionImportReportQuery() {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== IMPORT_UPDATED_MESSAGE_TYPE) return;
    queryClient.invalidateQueries({
      queryKey: importKeys.notion.queryKey,
    });
  });

  return useQuery(() => notionImportReportQueryOptions());
}

/**
 * Stop the Notion workspace import. Objects already imported stay; the
 * returned report replaces the cached one.
 */
export function useCancelNotionImportMutation() {
  return useMutation(() => ({
    mutationFn: () => throwOnErr(() => importClient.cancelNotion()),
    onSuccess: (report: NotionImportReport) => {
      queryClient.setQueryData(importKeys.notion.queryKey, report);
      fireAndForget(invalidateImportState(), 'import-state');
    },
  }));
}
