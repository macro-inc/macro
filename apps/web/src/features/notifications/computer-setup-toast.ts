import {
  type ComputerSetupNotice,
  showComputerSetupNotice,
} from '@app/features/settings/computers/primitives/setup-notice';
import { requestComputerSetup } from '@app/features/settings/computers/primitives/setup-request';
import { showTeamAgentSetupFailure } from '@app/features/settings/primitives/team-agent-setup-notice';
import { retryTeamAgentComputer } from '@app/features/settings/primitives/team-agent-status';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  openBillingSettings,
  openRuntimesSettings,
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

/** Settings → Billing, from wherever the app is: to update a declined card. */
export function openBilling() {
  const layout = globalSplitManager();
  if (layout) openBillingSettings(layout, {});
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

/** A computer setup notification that arrived while the app is open. */
export function showComputerSetupToast(notice: ComputerSetupNotice) {
  const agent = notice.agent;
  if (agent) {
    if (notice.outcome.kind === 'failed') {
      showTeamAgentSetupFailure(
        notice.computerId,
        agent.name,
        notice.outcome.failureReason,
        () =>
          fireAndForget(
            retryAgentSetup(notice.computerId, agent),
            'notifications'
          )
      );
    }
    return;
  }
  fireAndForget(
    showComputerSetupNotice(notice, () => openComputerSetup(notice.computerId)),
    'notifications'
  );
}
