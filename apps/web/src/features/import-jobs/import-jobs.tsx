import { globalSplitManager } from '@app/signal/splitLayout';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { appConnectorKey, connectConnector } from '@queries/connectors';
import { queryReadyGate } from '@queries/gate';
import {
  useImportRunsQuery,
  useWorkspaceImportReportQuery,
} from '@queries/import';
import { type JSX, Show } from 'solid-js';
import type { ImportJobsContext } from './context/contracts';
import { ImportJobsProvider } from './context/import-jobs-context';
import type { WorkspaceSource } from './core/import-job';
import {
  onDismissedRunsChange,
  readDismissedRuns,
  writeDismissedRuns,
} from './dismissed-runs';
import {
  ImportJobsCornerView,
  ImportJobsRailView,
} from './views/import-jobs-tray';

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
      return connectConnector({ key: appConnectorKey(source) });
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
 * signed in to the app shell, where sessions can be opened. `onEmptied` takes
 * focus somewhere stable when the last row is dismissed.
 */
export function ImportJobsRailButton(props: {
  onEmptied?: () => void;
}): JSX.Element {
  const authenticated = useIsAuthenticated();

  return (
    <Show when={authenticated() && globalSplitManager()}>
      <ImportJobsProvider context={useProductionContext()}>
        <ImportJobsRailView onEmptied={props.onEmptied} />
      </ImportJobsProvider>
    </Show>
  );
}

/**
 * Background imports in the toast corner, for touch layouts wide enough to
 * show them but without the rail (tablets), until they get a mobile view.
 */
export function ImportJobsCornerTray(): JSX.Element {
  const authenticated = useIsAuthenticated();

  return (
    <Show when={authenticated() && globalSplitManager()}>
      <ImportJobsProvider context={useProductionContext()}>
        <ImportJobsCornerView />
      </ImportJobsProvider>
    </Show>
  );
}
