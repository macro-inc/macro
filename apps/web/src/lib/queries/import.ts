/**
 * Queries and mutations for the import pipeline.
 *
 * The server owns everything: gather jobs stage candidates, `POST
 * /import/run` accepts/declines them, and import jobs flip rows to
 * `imported`. Row flips are pushed over the connection gateway as
 * `import_updated`; polling remains as the backstop (pushes can be missed
 * while reconnecting), tightening while anything is in flight.
 */
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type ImportEntity,
  type ImportSource,
  type ImportState,
  importClient,
  type SlackChannelMeta,
} from '@service-cognition/import';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import {
  type UseMutationResult,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';

export type {
  ImportEntity,
  ImportEntityStatus,
  ImportRun,
  ImportRunStatus,
  ImportSource,
  ImportState,
  SlackChannelMeta,
} from '@service-cognition/import';

const KEYS = {
  state: ['import', 'state'] as const,
};

/** Gateway push sent when an import row or gather run changes server-side. */
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
    state.runs.some(
      (run) => run.status === 'running' || run.status === 'importing'
    ) || state.entities.some((entity) => entity.status === 'importing')
  );
}

/** The import aggregate: gather runs plus visible ledger rows. */
export function useImportQuery(options?: { enabled?: () => boolean }) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== IMPORT_UPDATED_MESSAGE_TYPE) return;
    void invalidateImportState();
  });

  return useQuery(() => ({
    queryKey: KEYS.state,
    queryFn: async () => throwOnErr(() => importClient.getState()),
    enabled: options?.enabled ? options.enabled() : true,
    refetchInterval: (query) =>
      anythingInFlight(query.state.data) ? 3_000 : 15_000,
    placeholderData: PENDING_IMPORT_STATE,
  }));
}

function invalidateImportState() {
  return queryClient.invalidateQueries({ queryKey: KEYS.state });
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
    onSuccess: () => void invalidateImportState(),
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
    onSuccess: () => void invalidateImportState(),
  }));
}

/** Slack channel metadata, only for Slack ledger rows. */
export function slackChannelMeta(
  entity: ImportEntity
): SlackChannelMeta | null {
  if (entity.source !== 'slack') return null;
  return entity.metadata as SlackChannelMeta;
}
