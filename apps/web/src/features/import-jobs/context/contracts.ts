import type { ImportRun, NotionImportReport } from '@service-cognition/import';
import type { Accessor } from 'solid-js';
import type { WorkspaceSource } from '../core/import-job';

/** Where dismissed runs are remembered, so a reload keeps them hidden. */
export type ImportDismissals = {
  restore(): readonly string[];
  save(keys: readonly string[]): void;
  /** Calls back when a dismissal is recorded elsewhere (the review card). */
  subscribe?(onChange: () => void): () => void;
};

/** How a connect flow ended, as the app's connect flow reports it. */
export type ReconnectOutcome = 'connected' | 'closed';

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
  /** Open the agent session presenting an import's review, and focus it. */
  openSession(sessionId: string): void;
  /** Whether that session is already the active split; reactive. */
  isSessionActive(sessionId: string): boolean;
  /** Called once by the mounted tray. */
  createDismissals(): ImportDismissals;
  /** Run the source's connect flow again; rejects when it failed. */
  reconnect(source: WorkspaceSource): Promise<ReconnectOutcome>;
};
