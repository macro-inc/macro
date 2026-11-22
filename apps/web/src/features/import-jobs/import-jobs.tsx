import { globalSplitManager } from '@app/signal/splitLayout';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { queryReadyGate } from '@queries/gate';
import {
  useImportRunsQuery,
  useWorkspaceImportReportQuery,
} from '@queries/import';
import { connectPipedreamApp } from '@queries/pipedream-connectors';
import { type JSX, Show } from 'solid-js';
import type { ImportJobsContext } from './context/contracts';
import { ImportJobsProvider } from './context/import-jobs-context';
import type { WorkspaceSource } from './core/import-job';
import {
  onDismissedRunsChange,
  readDismissedRuns,
  writeDismissedRuns,
} from './dismissed-runs';
import { ImportJobsRailView } from './views/import-jobs-tray';

// Product names, not translated.
const SOURCE_NAMES: Record<WorkspaceSource, string> = {
  notion: 'Notion',
  linear: 'Linear',
  jira: 'Jira',
};

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
    createDismissals() {
      const userId = useUserId();
      return {
        restore() {
          const user = userId();
          return user ? readDismissedRuns(user) : [];
        },
        save(keys) {
          const user = userId();
          if (user) writeDismissedRuns(user, keys);
        },
        subscribe: onDismissedRunsChange,
      };
    },
    reconnect(source) {
      return connectPipedreamApp({
        appSlug: source,
        serverName: SOURCE_NAMES[source],
      });
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
 * Background imports as a button in the rail's footer. Mounted only while
 * signed in to the app shell, where sessions can be opened.
 */
export function ImportJobsRailButton(): JSX.Element {
  const authenticated = useIsAuthenticated();

  return (
    <Show when={authenticated() && globalSplitManager()}>
      <ImportJobsProvider context={useProductionContext()}>
        <ImportJobsRailView />
      </ImportJobsProvider>
    </Show>
  );
}
