import type { NotionImportReport } from '@service-cognition/import';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
} from 'solid-js';
import type { ImportDismissals, ImportRunsSource } from '../context/contracts';
import {
  type ImportJob,
  importJob,
  importJobKey,
  isWorkspaceSource,
  nextExpiry,
  visibleImportRuns,
  type WorkspaceSource,
} from '../core/import-job';

/**
 * The tray's jobs. Each listed workspace run reads its own report, created
 * when the run appears and disposed when it leaves; dismissals are kept in
 * `dismissals`, so a reload keeps a dismissed failure hidden.
 */
export function createImportJobs(sources: {
  runs: ImportRunsSource;
  createReport: (
    source: WorkspaceSource
  ) => Accessor<NotionImportReport | undefined>;
  dismissals: ImportDismissals;
}) {
  const [dismissed, setDismissed] = createSignal<readonly string[]>(
    sources.dismissals.restore()
  );
  // A dismissal recorded elsewhere (the review card) hides the entry here too.
  const unsubscribe = sources.dismissals.subscribe?.(() =>
    setDismissed(sources.dismissals.restore())
  );
  if (unsubscribe) onCleanup(unsubscribe);
  const [now, setNow] = createSignal(Date.now());

  const visible = createMemo(() =>
    visibleImportRuns(sources.runs.runs(), {
      now: now(),
      dismissed: new Set(dismissed()),
      slackChannelsImporting: sources.runs.slackChannelsImporting(),
    })
  );

  createEffect(() => {
    const expiry = nextExpiry(visible(), sources.runs.slackChannelsImporting());
    if (expiry === null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expiry - Date.now())
    );
    onCleanup(() => clearTimeout(timer));
  });

  const workspaceSources = createMemo(() =>
    visible()
      .map((run) => run.source)
      .filter(isWorkspaceSource)
  );
  const reports = mapArray(workspaceSources, (source) => ({
    source,
    report: sources.createReport(source),
  }));

  const jobs = createMemo((): ImportJob[] =>
    visible().map((run) =>
      importJob(run, {
        report: reports()
          .find((entry) => entry.source === run.source)
          ?.report(),
        slackChannelsImporting: sources.runs.slackChannelsImporting(),
      })
    )
  );

  function dismiss(key: string) {
    // Keep only keys of runs still listed by the server, so the store stays
    // as small as the runs themselves.
    const current = new Set(sources.runs.runs().map(importJobKey));
    const next = [
      ...dismissed().filter((previous) => current.has(previous)),
      key,
    ];
    setDismissed(next);
    sources.dismissals.save(next);
  }

  return { jobs, dismiss };
}
