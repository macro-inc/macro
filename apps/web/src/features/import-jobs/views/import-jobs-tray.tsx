import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { ImportJobsTray as ImportJobsTrayCard } from '../components/import-jobs-tray';
import { useImportJobs } from '../context/import-jobs-context';
import { type ImportJob, isWorkspaceSource } from '../core/import-job';
import { createImportJobs } from '../primitives/import-jobs';

// Product names, not translated.
const SOURCE_NAMES = { notion: 'Notion', linear: 'Linear', jira: 'Jira' };

/** The tray over the provided import sources, opening jobs through the host. */
export function ImportJobsTrayView() {
  const context = useImportJobs();
  const imports = createImportJobs({
    runs: context.createRuns(),
    createReport: context.createReport,
    dismissals: context.createDismissals(),
  });
  const [expanded, setExpanded] = createSignal(true);

  function open(job: ImportJob) {
    if (job.sessionId) context.openSession(job.sessionId);
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

  return (
    <ImportJobsTrayCard
      jobs={imports.jobs()}
      expanded={expanded()}
      onExpandedChange={setExpanded}
      onOpen={open}
      onDismiss={(job) => imports.dismiss(job.key)}
      onReconnect={(job) => fireAndForget(reconnect(job), 'import-jobs')}
    />
  );
}
