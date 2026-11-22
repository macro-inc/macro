import {
  type ImportRun,
  type ImportSource,
  type NotionImportReport,
  parseRunErrorKind,
  type RunErrorKind,
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
  /** `partial` when some objects could not be imported. */
  | { kind: 'completed'; partial: boolean }
  /** `errorKind` says why, when the server recorded it. */
  | { kind: 'failed'; errorKind: RunErrorKind | null }
  | { kind: 'cancelled' };

/** How long a run waiting on the owner (a plan to approve) stays listed. */
export const RECENT_MS = 60 * 60 * 1000;

/** How long a finished or cancelled run stays listed, like a toast. */
export const FINISHED_MS = 5 * 1000;

/** How long a failure stays listed when it is never dismissed. */
export const FAILED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long after its last change a run that stopped moving stays listed:
 * a finished one briefly, a failed one until it is dismissed or a week old,
 * and one that finished with failures until it is dismissed.
 */
function listedFor(run: ImportRun): number {
  return (
    match(run.status)
      // One that finished with objects it could not import needs action, so
      // it stays until dismissed, however old.
      .with('completed', () =>
        run.error ? Number.POSITIVE_INFINITY : FINISHED_MS
      )
      .with('dismissed', () => FINISHED_MS)
      .with('failed', () => FAILED_MS)
      .with('running', 'ready', 'importing', () => RECENT_MS)
      .exhaustive()
  );
}

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
 * The runs the tray lists: every moving run, and the rest until dismissed
 * or their listing time (`listedFor`) has passed.
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
    return age < listedFor(run);
  });
}

/**
 * When the next listed settled run leaves the tray, or null when none will.
 * Nothing else changes while imports are idle, so the tray re-reads the
 * clock then.
 */
export function nextExpiry(
  visible: readonly ImportRun[],
  slackChannelsImporting: number
): number | null {
  const expiries = visible
    .filter((run) => !isMoving(run, slackChannelsImporting))
    .map((run) => Date.parse(run.updated_at) + listedFor(run))
    .filter(Number.isFinite);
  return expiries.length === 0 ? null : Math.min(...expiries);
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
    .with('completed', () => ({
      kind: 'completed',
      partial: Boolean(run.error),
    }))
    .with('failed', () => ({
      kind: 'failed',
      errorKind: parseRunErrorKind(run.error_kind),
    }))
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
