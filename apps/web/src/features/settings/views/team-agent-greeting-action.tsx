import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useOwnedAgentComputerHarness } from '../primitives/owned-agent-computer-harness';
import { openAgentClaude } from '../primitives/team-agent-claude-request';
import { useTeamAgentStatus } from '../primitives/team-agent-status';

/** The optional Claude plan action alongside the agent's first message to its inviter. */
export function TeamAgentGreetingAction(props: { userId: string }) {
  const viewerId = useUserId();
  const status = useTeamAgentStatus(() => props.userId);
  const computerId = () => {
    const agent = status.agent();
    if (agent && agent.createdBy === viewerId()) return agent.computerId;
  };
  const harness = useOwnedAgentComputerHarness(computerId);
  const applicable = () => {
    const owned = harness();
    return owned?.connected && owned.claude_mode === 'macro_credits';
  };
  return (
    <Show when={applicable()}>
      <div class="ml-10 mt-1">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          class="rounded-full"
          onClick={() => {
            if (applicable()) openAgentClaude(props.userId);
          }}
        >
          {t('teamAgents.connectClaude')}
        </Button>
      </div>
    </Show>
  );
}
