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
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { openDirectMessage } from '@core/util/open-direct-message';
import { Telemetry } from '@macro-inc/observability';
import { cachedUserId } from '@queries/auth/cached-user-id';
import { getOrCreateDirectMessageChannel } from '@queries/channel/get-or-create-dm';
import { fetchHarnesses } from '@queries/harnesses/harnesses';
import {
  openBillingSettings,
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

/**
 * The DM with an agent teammate, from wherever the app is. An agent says hi
 * first, so this opens the real DM (creating it if needed) rather than a DM
 * that only the viewer's first message would create: that one would never
 * show the greeting, and a reload would lose it.
 */
export function openAgentDirectMessage(agentUserId: string) {
  const layout = globalSplitManager();
  if (!layout) return;
  const open = (content: SplitContent) =>
    layout.openWithSplit(content, { activate: true, referredFrom: null });
  fireAndForget(
    Telemetry.span('team-agent.open_dm', async (span) => {
      const channel = await getOrCreateDirectMessageChannel(agentUserId);
      if (channel.isOk()) {
        span.setAttr('channel.id', channel.value);
        open({ type: 'channel', id: channel.value });
        return;
      }
      // Still open the conversation; the viewer's first message creates it.
      span.error(channel.error);
      await openDirectMessage(cachedUserId(), agentUserId, open);
    }),
    'notifications'
  );
}

/** Settings → Billing, from wherever the app is: to update a declined card. */
export function openBilling() {
  const layout = globalSplitManager();
  if (layout) openBillingSettings(layout, {});
}

/** Connect Claude plan for an agent teammate, on its row in Settings → Members. */
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
  const canConnectClaude =
    notice.outcome.kind === 'ready' && (await ownsHarness(notice.harnessId));
  showTeamAgentSetupNotice(notice, agent, {
    message: () => openAgentDirectMessage(agent.userId),
    connectClaude: canConnectClaude
      ? () => openAgentClaude(agent.userId)
      : undefined,
    retry: () =>
      fireAndForget(retryAgentSetup(notice.computerId, agent), 'notifications'),
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
