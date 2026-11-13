import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useClaudeModeQuery,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { TeamAgent } from '@service-auth/team-agents';
import { confirmDialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import { TeamAgentClaudeStatus } from '../components/team-agent-claude-status';
import { ClaudeSignInDialog } from '../computers/views/claude-sign-in-dialog';
import {
  agentClaudeMode,
  agentClaudeState,
  agentComputerHarness,
} from '../core/team-agent-claude';

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
  const [signingIn, setSigningIn] = createSignal(false);

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
            onSignIn={() => setSigningIn(true)}
            onUseCredits={() =>
              fireAndForget(useCredits(id()), 'team-agent.claude')
            }
          />
          <Show when={signingIn()}>
            <ClaudeSignInDialog
              harnessId={id()}
              entry="team_agent_row"
              onClose={() => setSigningIn(false)}
            />
          </Show>
        </>
      )}
    </Show>
  );
}
