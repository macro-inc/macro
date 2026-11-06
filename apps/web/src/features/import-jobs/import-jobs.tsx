import { globalSplitManager } from '@app/signal/splitLayout';
import { useIsAuthenticated } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import {
  useImportRunsQuery,
  useWorkspaceImportReportQuery,
} from '@queries/import';
import { type JSX, Show } from 'solid-js';
import type { ImportJobsContext } from './context/contracts';
import { ImportJobsProvider } from './context/import-jobs-context';
import type { WorkspaceSource } from './core/import-job';
import { ImportJobsTrayView } from './views/import-jobs-tray';

function useProductionContext(): ImportJobsContext {
  return {
    createRuns() {
      const query = useImportRunsQuery();
      const state = () => (queryReadyGate(query) ? query.data : undefined);
      return {
        runs: () => state()?.runs ?? [],
        slackChannelsImporting: () =>
          state()?.entities.filter(
            (entity) =>
              entity.source === 'slack' && entity.status === 'importing'
          ).length ?? 0,
      };
    },
    createReport(source: WorkspaceSource) {
      const query = useWorkspaceImportReportQuery(() => source);
      return () => (queryReadyGate(query) ? query.data : undefined);
    },
    openSession(sessionId) {
      globalSplitManager()?.openWithSplit(
        { type: 'agent', id: sessionId },
        { activate: true }
      );
    },
  };
}

/**
 * Background imports in the desktop corner, beside upload progress. Mounted
 * only while signed in to the app shell, where sessions can be opened.
 */
export function ImportJobsTray(): JSX.Element {
  const authenticated = useIsAuthenticated();

  return (
    <Show when={authenticated() && globalSplitManager()}>
      <ImportJobsProvider context={useProductionContext()}>
        <ImportJobsTrayView />
      </ImportJobsProvider>
    </Show>
  );
}
