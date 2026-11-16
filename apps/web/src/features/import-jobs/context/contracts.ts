import type { ImportRun, NotionImportReport } from '@service-cognition/import';
import type { Accessor } from 'solid-js';
import type { WorkspaceSource } from '../core/import-job';

/** The user's import runs and the Slack channels being imported now. */
export type ImportRunsSource = {
  runs: Accessor<readonly ImportRun[]>;
  slackChannelsImporting: Accessor<number>;
};

export type ImportJobsContext = {
  /** Called once by the mounted tray. */
  createRuns(): ImportRunsSource;
  /** Called for each listed workspace run, living as long as its row. */
  createReport(
    source: WorkspaceSource
  ): Accessor<NotionImportReport | undefined>;
  /** Open the agent session presenting an import's review. */
  openSession(sessionId: string): void;
};
