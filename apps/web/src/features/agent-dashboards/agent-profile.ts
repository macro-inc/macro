import { beginInteraction } from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  enableAgentDashboards,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { isAgentAccount, tryMacroId } from '@core/user';
import { agentProfileTarget } from './core/dashboard';
import { agentDashboardContent } from './dashboard-navigation';

/** Where a click that opened an agent's profile came from, for traces. */
export type AgentProfileSurface =
  | 'avatar'
  | 'sender-name'
  | 'mention'
  | 'member-list'
  | 'user-card'
  | 'dm-header';

export type AgentProfile = {
  /**
   * The account whose profile a click on `userId` opens: the account itself
   * when it is an agent and agent dashboards are on, else undefined, and the
   * click keeps its usual behavior.
   */
  profileOf: (userId: string | undefined) => string | undefined;
  /** Opens the agent's profile in a new pane (in front, on touch). */
  open: (userId: string, surface: AgentProfileSurface, event?: Event) => void;
};

/**
 * Clicking an agent teammate (its picture, name, @mention, or member row)
 * opens its profile: the agent account page with its dashboard. The
 * navigation is an interaction the routed `view.agent-dashboard` flow joins.
 *
 * Every avatar and mention calls this, including pages and fixtures without
 * the PostHog provider, so the flag is read with `isFeatureEnabled` inside
 * `profileOf`, at each read, rather than with `useFeatureFlag`.
 */
export function useAgentProfile(): AgentProfile {
  const { openWithSplit } = useSplitLayout();

  return {
    profileOf: (userId) =>
      agentProfileTarget({
        userId,
        flagEnabled: isFeatureEnabled(enableAgentDashboards),
        isAgentAccount: (id) => isAgentAccount(tryMacroId(id)),
      }),
    open: (userId, surface, event) => {
      const interaction = beginInteraction('agent_profile.open', {
        event,
        attributes: { 'agent_profile.surface': surface },
      });
      try {
        // Touch devices ignore preferNewSplit and open it in front.
        openWithSplit(agentDashboardContent(userId), {
          activate: true,
          preferNewSplit: true,
        });
      } finally {
        interaction.end();
      }
    },
  };
}
