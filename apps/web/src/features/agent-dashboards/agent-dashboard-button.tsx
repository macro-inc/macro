import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { useNavigate } from '@app/lib/split-router';
import { agentDashboardRoute } from '@app/routes/routes';
import { useChannelParticipants } from '@channel/use-channel-participants';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { enableAgentDashboards } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isAgentAccount, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import { Show } from 'solid-js';
import { directMessageAgent } from './core/dashboard';

/**
 * A direct message's Dashboard action: opens the page of the agent on the
 * other side, beside the conversation. Renders nothing for people or with the
 * flag off.
 */
export function AgentDashboardButton(props: { channelId: string }) {
  const flag = useFeatureFlag(enableAgentDashboards);
  const viewerId = useUserId();
  const participants = useChannelParticipants(() => props.channelId);
  const navigate = useNavigate();

  const agentId = () => {
    if (!flag().enabled) return undefined;

    return directMessageAgent({
      isDirectMessage: true,
      participantIds: participants.ids(),
      viewerId: viewerId(),
      isAgentAccount: (id) => isAgentAccount(tryMacroId(id)),
    });
  };

  return (
    <Show when={agentId()}>
      {(userId) => (
        <HeaderActionButton
          label={t('agentDashboards.dashboardTab')}
          tooltip={t('agentDashboards.openDashboard')}
          icon={<SquaresFourIcon class="size-4 shrink-0" />}
          onClick={() =>
            fireAndForget(
              navigate(
                { route: agentDashboardRoute, params: { userId: userId() } },
                { newPane: true }
              ),
              'agent-dashboards'
            )
          }
        />
      )}
    </Show>
  );
}
