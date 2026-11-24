import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ResultAsync } from 'neverthrow';
import { createEffect, createSignal, on } from 'solid-js';
import { match } from 'ts-pattern';
import {
  ImportJobsCornerTray,
  ImportJobsRailButton,
} from '../components/import-jobs-tray';
import { useImportJobs } from '../context/import-jobs-context';
import { type ImportJob, isWorkspaceSource } from '../core/import-job';
import { createImportJobs } from '../primitives/import-jobs';

// Product names, not translated.
const SOURCE_NAMES = { notion: 'Notion', linear: 'Linear', jira: 'Jira' };

/** The jobs over the provided sources, and the actions both layouts share. */
function useImportJobsActions(onOpened: () => void) {
  const context = useImportJobs();
  const imports = createImportJobs({
    runs: context.createRuns(),
    createReport: context.createReport,
    dismissals: context.createDismissals(),
  });

  function open(job: ImportJob) {
    if (!job.sessionId) return;
    onOpened();
    context.openSession(job.sessionId);
  }

  async function reconnect(job: ImportJob) {
    if (!isWorkspaceSource(job.source)) return;
    const name = SOURCE_NAMES[job.source];
    const outcome = await ResultAsync.fromPromise(
      context.reconnect(job.source),
      () => ({ kind: 'connect-failed' as const })
    );
    if (outcome.isErr()) {
      toast.failure(t('importJobs.reconnectFailed', { source: name }));
      return;
    }
    match(outcome.value)
      .with('connected', () =>
        toast.success(t('importJobs.reconnected', { source: name }), {
          subtext: t('importJobs.reconnectedNext'),
        })
      )
      // Closed without finishing: nothing changed, nothing to say.
      .with('closed', () => undefined)
      .exhaustive();
  }

  return {
    jobs: imports.jobs,
    isSessionActive: context.isSessionActive,
    open,
    dismiss: (job: ImportJob) => imports.dismiss(job.key),
    reconnect: (job: ImportJob) => fireAndForget(reconnect(job), 'import-jobs'),
  };
}

/**
 * The rail's imports button over the provided sources, opening jobs through
 * the host. `onEmptied` runs when the owner dismissed the last row, since the
 * button (and the focus inside its list) goes with it.
 */
export function ImportJobsRailView(props: { onEmptied?: () => void }) {
  const [listOpen, setListOpen] = createSignal(false);
  const imports = useImportJobsActions(() => setListOpen(false));
  // The button unmounts with the last job without closing its list, so the
  // next import would mount it open: close it when the list empties.
  createEffect(
    on(
      () => imports.jobs().length === 0,
      (empty) => {
        if (empty) setListOpen(false);
      },
      { defer: true }
    )
  );

  function dismiss(job: ImportJob) {
    const last = imports.jobs().length === 1;
    imports.dismiss(job);
    if (last) props.onEmptied?.();
  }

  return (
    <ImportJobsRailButton
      jobs={imports.jobs()}
      open={listOpen()}
      onOpenChange={setListOpen}
      isSessionActive={imports.isSessionActive}
      onOpen={imports.open}
      onDismiss={dismiss}
      onReconnect={imports.reconnect}
    />
  );
}

/** The corner pill for touch layouts without the rail (tablets). */
export function ImportJobsCornerView() {
  const imports = useImportJobsActions(() => undefined);
  const [expanded, setExpanded] = createSignal(true);
  return (
    <ImportJobsCornerTray
      jobs={imports.jobs()}
      expanded={expanded()}
      onExpandedChange={setExpanded}
      isSessionActive={imports.isSessionActive}
      onOpen={imports.open}
      onDismiss={imports.dismiss}
      onReconnect={imports.reconnect}
    />
  );
}
