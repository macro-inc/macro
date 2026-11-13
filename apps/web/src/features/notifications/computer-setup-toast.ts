import {
  type ComputerSetupNotice,
  showComputerSetupNotice,
} from '@app/features/settings/computers/primitives/setup-notice';
import { requestComputerSetup } from '@app/features/settings/computers/primitives/setup-request';
import { requestAgentClaude } from '@app/features/settings/primitives/team-agent-claude-request';
import { showTeamAgentSetupNotice } from '@app/features/settings/primitives/team-agent-setup-notice';
import { retryTeamAgentComputer } from '@app/features/settings/primitives/team-agent-status';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { openDirectMessage } from '@core/util/open-direct-message';
import { cachedUserId } from '@queries/auth/cached-user-id';
import { fetchHarnesses } from '@queries/harnesses/harnesses';
import {
  openRuntimesSettings,
  openTeamMembersSettings,
} from './notification-navigation';

/**
 * Back into the computer's guided setup on Bring your AI, from wherever the
 * app is: Settings → Machines opens and reopens the setup dialog there.
 */
export function openComputerSetup(computerId: string) {
  requestComputerSetup(computerId);
  const layout = globalSplitManager();
  if (layout) openRuntimesSettings(layout, {});
}

/** The DM with an agent teammate, from wherever the app is. */
export function openAgentDirectMessage(agentUserId: string) {
  const layout = globalSplitManager();
  if (!layout) return;
  fireAndForget(
    openDirectMessage(cachedUserId(), agentUserId, (content) => {
      layout.openWithSplit(content, { activate: true, referredFrom: null });
    }),
    'notifications'
  );
}

/** Bring your AI for an agent teammate, on its row in Settings → Members. */
export function openAgentClaude(agentUserId: string) {
  requestAgentClaude(agentUserId);
  const layout = globalSplitManager();
  if (layout) openTeamMembersSettings(layout, {});
}

/**
 * Whether the viewer may bring their AI to the computer: only those who own
 * its runtime (the team's owner and admins) can sign it in to Claude.
 */
async function ownsHarness(harnessId: string | null | undefined) {
  if (!harnessId) return false;
  try {
    const harnesses = await fetchHarnesses();
    return harnesses.some(
      (harness) =>
        harness.id === harnessId &&
        harness.access === 'owner' &&
        harness.connected
    );
  } catch {
    return false;
  }
}

type SetupAgent = NonNullable<ComputerSetupNotice['agent']>;

/** The failure notice's Retry: the agent's computer, set up again. */
async function retryAgentSetup(computerId: string, agent: SetupAgent) {
  try {
    await retryTeamAgentComputer(computerId);
  } catch {
    toast.failure(t('teamAgents.retryFailed', { name: agent.name }));
  }
}

async function showAgentSetupToast(
  notice: ComputerSetupNotice,
  agent: SetupAgent
) {
  const canBringAi =
    notice.outcome.kind === 'ready' && (await ownsHarness(notice.harnessId));
  showTeamAgentSetupNotice(notice, agent, {
    message: () => openAgentDirectMessage(agent.userId),
    bringAi: canBringAi ? () => openAgentClaude(agent.userId) : undefined,
    retry: () =>
      fireAndForget(
        retryAgentSetup(notice.computerId, agent),
        'notifications'
      ),
  });
}

/** A computer setup notification that arrived while the app is open. */
export function showComputerSetupToast(notice: ComputerSetupNotice) {
  const agent = notice.agent;
  if (agent) {
    fireAndForget(showAgentSetupToast(notice, agent), 'notifications');
    return;
  }
  showComputerSetupNotice(notice, () => openComputerSetup(notice.computerId));
}
