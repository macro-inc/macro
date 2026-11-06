import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { getMeetingPath } from '@channel/Call/call-link';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { useCallLinkQuery } from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import type { Accessor } from 'solid-js';

/** Rejoin a channel call or open the invitation for a standalone meeting. */
export function useCallAgain(
  callId: Accessor<string>,
  channelId: Accessor<string | null | undefined>
) {
  const navigate = useNavigate();
  const flag = useQuickCallsFlag();
  const quickCallsEnabled = () => !flag().loading && flag().enabled;
  const meeting = useCallLinkQuery(() =>
    quickCallsEnabled() && !channelId() ? callId() : undefined
  );
  const shareToken = () =>
    quickCallsEnabled() && meeting.isSuccess
      ? meeting.data?.shareToken
      : undefined;
  const canCallAgain = () => Boolean(channelId() || shareToken());
  const rejoin = async (channel: string) => {
    try {
      await joinChannelCall(channel);
    } catch (error) {
      toast.failure('Failed to join call');
      Telemetry.error(error, { surface: 'call-again' });
    }
  };
  const callAgain = () => {
    const channel = channelId();
    if (channel) {
      fireAndForget(rejoin(channel), 'call-again');
      return;
    }
    const token = shareToken();
    if (token) navigate(getMeetingPath(token));
  };

  return { canCallAgain, callAgain };
}
