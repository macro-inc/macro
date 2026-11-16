import type { NotionImportReport } from '@service-cognition/import';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  mapArray,
  onCleanup,
} from 'solid-js';
import type { ImportRunsSource } from '../context/contracts';
import {
  type ImportJob,
  importJob,
  isWorkspaceSource,
  nextExpiry,
  visibleImportRuns,
  type WorkspaceSource,
} from '../core/import-job';

/**
 * The tray's jobs. Each listed workspace run reads its own report, created
 * when the run appears and disposed when it leaves; dismissals last as long
 * as the tray.
 */
export function createImportJobs(sources: {
  runs: ImportRunsSource;
  createReport: (
    source: WorkspaceSource
  ) => Accessor<NotionImportReport | undefined>;
}) {
  const [dismissed, setDismissed] = createSignal<readonly string[]>([]);
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
    setDismissed((previous) => [...previous, key]);
  }

  return { jobs, dismiss };
}
