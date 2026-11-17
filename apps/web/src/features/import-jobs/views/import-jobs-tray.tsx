import { createSignal } from 'solid-js';
import { ImportJobsTray as ImportJobsTrayCard } from '../components/import-jobs-tray';
import { useImportJobs } from '../context/import-jobs-context';
import type { ImportJob } from '../core/import-job';
import { createImportJobs } from '../primitives/import-jobs';

/** The tray over the provided import sources, opening jobs through the host. */
export function ImportJobsTrayView() {
  const context = useImportJobs();
  const imports = createImportJobs({
    runs: context.createRuns(),
    createReport: context.createReport,
  });
  const [expanded, setExpanded] = createSignal(true);

  function open(job: ImportJob) {
    if (job.sessionId) context.openSession(job.sessionId);
  }

  return (
    <ImportJobsTrayCard
      jobs={imports.jobs()}
      expanded={expanded()}
      onExpandedChange={setExpanded}
      onOpen={open}
      onDismiss={(job) => imports.dismiss(job.key)}
    />
  );
}
