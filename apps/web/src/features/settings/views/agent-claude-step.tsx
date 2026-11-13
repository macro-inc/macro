import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import type { ClaudeSignInEntry } from '@queries/computers/claude';
import { useComputersQuery } from '@queries/computers/computers';
import type { TeamAgent } from '@service-auth/team-agents';
import { Show } from 'solid-js';
import { SetupProgressList } from '../computers/components/setup-progress-list';
import { ClaudeSignInDialog } from '../computers/views/claude-sign-in-dialog';
import { teamAgentComputer } from '../core/team-agent-setup';

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

  return (
    <ClaudeSignInDialog
      harnessId={props.harnessId}
      entry={props.entry}
      title={t('teamAgents.bringAiTitle', { name: props.agent.name })}
      header={
        <Show when={computer()}>
          {(current) => (
            <SetupProgressList
              computer={current()}
              signIn="needed"
              connected
              signedIn={false}
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
