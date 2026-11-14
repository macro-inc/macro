import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ClaudeSignInEntry } from '@queries/computers/claude';
import {
  useClaudeModeQuery,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { TeamAgent } from '@service-auth/team-agents';
import { confirmDialog } from '@ui';
import { createEffect, createSignal, Show } from 'solid-js';
import { TeamAgentClaudeStatus } from '../components/team-agent-claude-status';
import {
  agentClaudeMode,
  agentClaudeState,
  agentComputerHarness,
} from '../core/team-agent-claude';
import {
  agentClaudeRequest,
  consumeAgentClaudeRequest,
} from '../primitives/team-agent-claude-request';
import { AgentClaudeDialog } from './agent-claude-step';

/**
 * An agent teammate's Claude on its row in Members: sign its computer in to
 * the team's Claude plan, later or after the sign-in expired, or switch it
 * back to Macro credits. Only those who own the computer's runtime (the
 * team's owner and admins, so its inviter) see it; the server refuses
 * everyone else.
 */
export function TeamAgentClaude(props: { agent: TeamAgent }) {
  const computers = useFeatureFlag(enableMacroComputers);
  const harnesses = useHarnessesQuery();
  const harness = () => {
    if (!computers().enabled) return undefined;
    const found = agentComputerHarness(
      props.agent.computerId,
      harnesses.isSuccess ? harnesses.data : undefined
    );
    return found?.access === 'owner' ? found : undefined;
  };
  const harnessId = () => harness()?.id;
  // Only a computer on its own account has an expiry to read.
  const login = useClaudeModeQuery(() =>
    harness()?.claude_mode === 'own_account' ? harnessId() : undefined
  );
  const signOut = useClaudeSignOutMutation();
  // Where Bring your AI was opened from, while it is open.
  const [signingIn, setSigningIn] = createSignal<ClaudeSignInEntry>();

  // The agent's ready notification asks for Bring your AI; it opens once
  // the computer's runtime is listed as connected and the viewer's own.
  createEffect(() => {
    const request = agentClaudeRequest();
    if (!request || request.agentUserId !== props.agent.userId) return;
    if (!harness()?.connected) return;
    consumeAgentClaudeRequest(request.id);
    setSigningIn('notification');
  });

  const useCredits = async (id: string) => {
    const name = props.agent.name;
    const confirmed = await confirmDialog({
      title: t('teamAgents.useCreditsTitle', { name }),
      body: t('teamAgents.useCreditsBody', { name }),
      confirmLabel: t('teamAgents.useCredits'),
    });
    if (!confirmed) return;
    try {
      await signOut.mutateAsync(id);
    } catch {
      toast.failure(t('teamAgents.useCreditsFailed', { name }));
    }
  };

  return (
    <Show when={harnessId()}>
      {(id) => (
        <>
          <TeamAgentClaudeStatus
            state={agentClaudeState(
              agentClaudeMode(
                harness()?.claude_mode,
                login.isSuccess ? login.data : undefined
              ),
              Date.now()
            )}
            connected={!!harness()?.connected}
            pending={signOut.isPending}
            onSignIn={() => setSigningIn('team_agent_row')}
            onUseCredits={() =>
              fireAndForget(useCredits(id()), 'team-agent.claude')
            }
          />
          <Show when={signingIn()}>
            {(entry) => (
              <AgentClaudeDialog
                agent={props.agent}
                harnessId={id()}
                entry={entry()}
                onClose={() => setSigningIn(undefined)}
              />
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
