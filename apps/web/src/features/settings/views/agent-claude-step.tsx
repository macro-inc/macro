import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { useTeamAgentsQuery } from '@queries/team-agents/team-agents';
import type { TeamAgent } from '@service-auth/team-agents';
import { ActionDialogShell, Button, Spinner } from '@ui';
import { createMemo, Show } from 'solid-js';
import { ClaudeSignInFlow } from '../computers/views/claude-sign-in-flow';
import { agentComputerHarness } from '../core/team-agent-claude';

/**
 * Bring your AI for an agent teammate just invited: sign its new computer in
 * to the team's Claude plan, or skip and keep Macro credits. The sign-in link
 * comes from the computer, so the step waits until macrod connects there.
 *
 * Rendered as an `ActionDialogShell`'s body and footer; the host owns the dialog.
 */
export function AgentClaudeStep(props: {
  teamId: string;
  agent: TeamAgent;
  onDone: () => void;
}) {
  // The invite answers before the computer is bought or enrolled; the team's
  // agent list polls until it is, and the harness list until macrod connects.
  const agents = useTeamAgentsQuery(
    () => props.teamId,
    () => true
  );
  const harnesses = useHarnessesQuery();
  const computerId = () => {
    const live = agents.data?.agents.find(
      (agent) => agent.userId === props.agent.userId
    );
    return live?.computerId ?? props.agent.computerId;
  };

  // Once connected, stay on the sign-in even if a poll misses the computer,
  // so a half-pasted code is not thrown away.
  let readyHarnessId: string | undefined;
  const harnessId = createMemo(() => {
    if (readyHarnessId) return readyHarnessId;
    const harness = agentComputerHarness(computerId(), harnesses.data);
    if (harness?.connected) readyHarnessId = harness.id;
    return readyHarnessId;
  });

  const title = () => t('teamAgents.bringAiTitle', { name: props.agent.name });

  return (
    <Show
      when={harnessId()}
      fallback={
        <>
          <ActionDialogShell.Body>
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>{title()}</ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('teamAgents.bringAiWaiting', { name: props.agent.name })}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <p
              role="status"
              class="flex items-center gap-2 text-sm font-medium text-ink"
            >
              <Spinner size="sm" decorative />
              {t('computers.preparingSignIn')}
            </p>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button type="button" variant="ghost" onClick={props.onDone}>
              {t('teamAgents.keepCredits')}
            </Button>
          </ActionDialogShell.Footer>
        </>
      }
    >
      {(id) => (
        <ClaudeSignInFlow
          harnessId={id()}
          entry="team_agent_invite"
          title={title()}
          onSignedIn={() => {
            toast.success(
              t('teamAgents.claudeSignedIn', { name: props.agent.name })
            );
            props.onDone();
          }}
          onUseCredits={props.onDone}
        />
      )}
    </Show>
  );
}
