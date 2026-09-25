import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { getMeetingPath } from '@channel/Call/call-link';
import { joinChannelCall } from '@channel/Call/join-channel-call';
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
  const callAgain = () => {
    const channel = channelId();
    if (channel) {
      void joinChannelCall(channel);
      return;
    }
    const token = shareToken();
    if (token) navigate(getMeetingPath(token));
  };

  return { canCallAgain, callAgain };
}
