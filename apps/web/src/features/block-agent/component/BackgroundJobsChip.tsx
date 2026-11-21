import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import { useJobReveal } from '../context/job-reveal';

/**
 * "N jobs running" above the composer while background jobs run in this session;
 * it brings the oldest running job's card into view. A job whose settle frame
 * was lost still stops counting once its durable `job.settled` event is in.
 */
export function BackgroundJobsChip() {
  const session = useOptionalAgentSession();
  const reveal = useJobReveal();
  const running = () => {
    const metadata = session?.metadata();
    if (!metadata) return [];
    const settled = new Set(
      metadata.notifications
        .filter((event) => event.kind === 'job.settled')
        .map((event) => event.subjectId)
    );
    return metadata.jobs.filter(
      (job) => job.status === 'running' && !settled.has(job.jobId)
    );
  };
  return (
    <Show when={running()[0]}>
      {(first) => (
        <div class="flex justify-start">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => reveal?.reveal(first().jobId)}
          >
            <span
              aria-hidden="true"
              class="size-1.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse"
            />
            {t('agentJobs.running', { count: running().length })}
          </Button>
        </div>
      )}
    </Show>
  );
}
