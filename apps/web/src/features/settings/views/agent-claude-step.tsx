import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ClaudeSignInEntry } from '@queries/computers/claude';
import { useComputersQuery } from '@queries/computers/computers';
import type { TeamAgent } from '@service-auth/team-agents';
import { createSignal, Show } from 'solid-js';
import { SetupProgressHeader } from '../computers/components/setup-progress-header';
import { ClaudeSignInDialog } from '../computers/views/claude-sign-in-dialog';
import { teamAgentComputer } from '../core/team-agent-setup';
import { useRetryTeamAgentSetup } from '../primitives/team-agent-status';

/**
 * Bring your AI for an agent teammate: sign its computer in to the team's
 * Claude plan, with the computer's setup progress above it. Opened from the
 * agent's row in Members or from its ready notification, never as a step of
 * the invite, and always closable; the agent runs on Macro credits until
 * then.
 */
export function AgentClaudeDialog(props: {
  agent: TeamAgent;
  /** The runtime on the agent's computer, connected. */
  harnessId: string;
  entry: ClaudeSignInEntry;
  onClose: () => void;
}) {
  const computers = useComputersQuery(() => true);
  const computer = () =>
    teamAgentComputer(
      props.agent,
      computers.isSuccess ? computers.data : undefined
    );
  const retry = useRetryTeamAgentSetup();
  // Open by default: the list is what says how far setup got.
  const [progressExpanded, setProgressExpanded] = createSignal(true);

  return (
    <ClaudeSignInDialog
      harnessId={props.harnessId}
      entry={props.entry}
      title={t('teamAgents.bringAiTitle', { name: props.agent.name })}
      header={
        <Show when={computer()}>
          {(current) => (
            <SetupProgressHeader
              steps={null}
              computer={current()}
              signIn="needed"
              connected
              signedIn={false}
              showProgress
              expanded={progressExpanded()}
              onExpandedChange={setProgressExpanded}
              onRetry={() =>
                fireAndForget(retry.run(props.agent), 'team-agent.retry')
              }
              retrying={retry.pending()}
            />
          )}
        </Show>
      }
      onSignedIn={() =>
        toast.success(
          t('teamAgents.claudeSignedIn', { name: props.agent.name })
        )
      }
      onClose={props.onClose}
    />
  );
}
