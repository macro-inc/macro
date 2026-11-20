import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';
import { useOptionalAgentSession } from '../context/AgentSessionContext';

/** Scroll a job's card into view; it stays where the agent started it. */
function revealJob(jobId: string) {
  document
    .querySelector(`[data-background-job="${CSS.escape(jobId)}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * "N running" above the composer while background jobs run in this session;
 * it takes the person to the oldest running job's card.
 */
export function BackgroundJobsChip() {
  const session = useOptionalAgentSession();
  const running = () =>
    session?.metadata()?.jobs.filter((job) => job.status === 'running') ?? [];
  return (
    <Show when={running()[0]}>
      {(first) => (
        <div class="flex justify-start">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => revealJob(first().jobId)}
          >
            {t('agentJobs.running', { count: running().length })}
          </Button>
        </div>
      )}
    </Show>
  );
}
