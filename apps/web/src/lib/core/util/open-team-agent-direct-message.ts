import { t } from '@app/lib/i18n';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import { Telemetry } from '@macro-inc/observability';
import {
  currentQueryAccount,
  isCurrentQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { getOrCreateDirectMessageChannel } from '@queries/channel/get-or-create-dm';

/**
 * Opens the DM with an agent teammate: the real one, created if needed. An
 * agent says hi first, so a DM that only the viewer's first message would
 * create (as `openDirectMessage` opens for people) would never show the
 * greeting, and a reload would lose it. A failure says so and opens nothing.
 *
 * `account` is the one the action was offered to (a notice captures it when
 * shown). If another account has signed in since, or signs in while the DM
 * is being made, nothing is made or opened for it.
 */
export function openTeamAgentDirectMessage(
  agentUserId: string,
  open: (content: SplitContent) => void,
  account: QueryAccount | undefined = currentQueryAccount()
) {
  return Telemetry.span('team_agent.open_direct_message', async (span) => {
    span.setAttr('agent.user_id', agentUserId);
    if (!isCurrentQueryAccount(account)) {
      span.setAttr('team_agent.open_direct_message.outcome', 'account_changed');
      return;
    }
    const channel = await getOrCreateDirectMessageChannel(agentUserId);
    if (!isCurrentQueryAccount(account)) {
      span.setAttr('team_agent.open_direct_message.outcome', 'account_changed');
      return;
    }
    if (channel.isErr()) {
      span.setAttr('team_agent.open_direct_message.outcome', 'failed');
      span.error(channel.error[0] ?? new Error('get_or_create_dm failed'));
      toast.failure(t('teamAgents.openDirectMessageFailed'));
      return;
    }
    span.setAttr('team_agent.open_direct_message.outcome', 'opened');
    span.setAttr('channel.id', channel.value);
    open({ type: 'channel', id: channel.value });
  });
}
