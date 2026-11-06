import type {
  ImportRun,
  ImportSource,
  NotionImportReport,
} from '@service-cognition/import';
import { match } from 'ts-pattern';

/** Sources reviewed as a whole workspace, each with its own report. */
export type WorkspaceSource = 'notion' | 'linear' | 'jira';

/** Where one import job stands, as the tray shows it. */
export type ImportJobPhase =
  | { kind: 'scanning'; found: number }
  | { kind: 'deciding'; remaining: number }
  | { kind: 'awaitingApproval' }
  | { kind: 'choosingChannels' }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'importingChannels'; channels: number }
  | { kind: 'completed' }
  | { kind: 'failed' }
  | { kind: 'cancelled' };

/** How long a run that stopped moving stays in the tray. */
export const RECENT_MS = 60 * 60 * 1000;

export function isWorkspaceSource(
  source: ImportSource
): source is WorkspaceSource {
  return source === 'notion' || source === 'linear' || source === 'jira';
}

/** Identifies one state of a run, so dismissing it hides only that state. */
export function importJobKey(run: ImportRun): string {
  return `${run.source}:${run.status}:${run.updated_at}`;
}

/** Whether the run is doing work right now, rather than waiting or done. */
export function isMoving(run: ImportRun, slackChannelsImporting: number) {
  if (run.status === 'running' || run.status === 'importing') return true;
  return run.source === 'slack' && slackChannelsImporting > 0;
}

/**
 * The runs the tray lists: every moving run, and the rest while they
 * changed within `RECENT_MS` and were not dismissed.
 */
export function visibleImportRuns(
  runs: readonly ImportRun[],
  options: {
    now: number;
    dismissed: ReadonlySet<string>;
    slackChannelsImporting: number;
  }
): ImportRun[] {
  return runs.filter((run) => {
    if (isMoving(run, options.slackChannelsImporting)) return true;
    if (options.dismissed.has(importJobKey(run))) return false;

    const age = options.now - Date.parse(run.updated_at);
    return age < RECENT_MS;
  });
}

/**
 * The run's phase. Workspace runs read their report for planning and
 * writing progress; Slack channel imports are counted from ledger rows.
 */
export function importJobPhase(
  run: ImportRun,
  details: {
    report: NotionImportReport | undefined;
    slackChannelsImporting: number;
  }
): ImportJobPhase {
  if (run.source === 'slack' && details.slackChannelsImporting > 0) {
    return {
      kind: 'importingChannels',
      channels: details.slackChannelsImporting,
    };
  }

  const report = details.report;
  return match(run.status)
    .returnType<ImportJobPhase>()
    .with('running', () => {
      const deciding = report?.deciding ?? 0;
      if (deciding > 0) return { kind: 'deciding', remaining: deciding };

      const found = run.scanned?.pages ?? report?.scanned?.pages ?? 0;
      return { kind: 'scanning', found };
    })
    .with('ready', () =>
      run.source === 'slack'
        ? { kind: 'choosingChannels' }
        : { kind: 'awaitingApproval' }
    )
    .with('importing', () => {
      const done = report?.imported ?? 0;
      const remaining =
        (report?.waiting ?? 0) +
        (report?.writing ?? 0) +
        (report?.waitingOnTeammates ?? 0);
      return { kind: 'importing', done, total: done + remaining };
    })
    .with('completed', () => ({ kind: 'completed' }))
    .with('failed', () => ({ kind: 'failed' }))
    .with('dismissed', () => ({ kind: 'cancelled' }))
    .exhaustive();
}

/** Completed fraction for a determinate phase, or null when unmeasured. */
export function phaseFraction(phase: ImportJobPhase): number | null {
  return match(phase)
    .with({ kind: 'importing' }, ({ done, total }) =>
      total > 0 ? done / total : null
    )
    .with({ kind: 'completed' }, () => 1)
    .otherwise(() => null);
}

/** One row of the tray. */
export type ImportJob = {
  key: string;
  source: ImportSource;
  phase: ImportJobPhase;
  /**
   * The agent session presenting the run's review. Absent for Slack, and
   * while a workspace plan is not presented yet.
   */
  sessionId: string | undefined;
  /** Only jobs that stopped moving can be dismissed. */
  dismissable: boolean;
};

export function importJob(
  run: ImportRun,
  details: {
    report: NotionImportReport | undefined;
    slackChannelsImporting: number;
  }
): ImportJob {
  return {
    key: importJobKey(run),
    source: run.source,
    phase: importJobPhase(run, details),
    sessionId: run.review_session_id ?? undefined,
    dismissable: !isMoving(run, details.slackChannelsImporting),
  };
}
