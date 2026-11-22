import { globalSplitManager } from '@app/signal/splitLayout';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { queryReadyGate } from '@queries/gate';
import {
  useImportRunsQuery,
  useWorkspaceImportReportQuery,
} from '@queries/import';
import { type JSX, Show } from 'solid-js';
import { z } from 'zod';
import type { ImportJobsContext } from './context/contracts';
import { ImportJobsProvider } from './context/import-jobs-context';
import type { WorkspaceSource } from './core/import-job';
import { ImportJobsTrayView } from './views/import-jobs-tray';

// Kept small: the newest dismissals win when there are too many.
const DISMISSED = z.array(z.string()).transform((keys) => keys.slice(-64));

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
      const storage = createUserScopedStorage('import-jobs:dismissed:v1');
      return {
        restore() {
          const user = userId();
          const raw = user ? storage.read(user) : null;
          if (raw === null) return [];
          const parsed = DISMISSED.safeParse(safeJson(raw));
          return parsed.success ? parsed.data : [];
        },
        save(keys) {
          const user = userId();
          if (user) storage.write(user, JSON.stringify(keys));
        },
      };
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
