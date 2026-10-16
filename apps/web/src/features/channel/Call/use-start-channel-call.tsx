import { analytics } from '@app/lib/analytics';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { useChannelName, useChannelType } from '@core/context/channels';
import { isMobile } from '@core/mobile/isMobile';
import PhoneIcon from '@phosphor/phone-call.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { ChannelTypeEnum } from '@service-storage/client';
import { confirmDialog } from '@ui';
import { getOwner } from 'solid-js';
import { getCallJoinTab, getCallLeaveTab } from './call-tabs';
import { useCall } from './use-call';

/**
 * Starts or joins a channel's call, as the header's Call button and the
 * composer's add menu both do. Must be used within `<ChannelTabProvider>`.
 */
export function useStartChannelCall(channelId: () => string) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });

  const activeCallQuery = useActiveCallQuery(channelId);
  const isCallInProgress = () => !!activeCallQuery.data;
  const channelName = useChannelName(channelId());
  const channelType = useChannelType(channelId());
  const isDm = () => channelType() === ChannelTypeEnum.DirectMessage;

  // Captured now so the confirmation drawer opened from a click handler
  // inherits the caller's lifetime (navigating away closes it).
  const owner = getOwner();

  const confirmTitle = () => {
    const name = channelName();
    if (!name) return 'Start a call?';
    return isDm() ? `Call ${name}?` : `Start a call in ${name}?`;
  };

  // A DM title ("Call Jane?") already says who rings; the group-channel case
  // is the one where the blast radius needs spelling out.
  const confirmBody = () =>
    isDm() ? undefined : 'Everyone in the channel will be notified.';

  const joinCall = async () => {
    if (call.isJoining()) return;
    const wasExistingCall = isCallInProgress();
    analytics.track('call_action', {
      action: 'join_clicked',
      channelId: channelId(),
      isExistingCall: wasExistingCall,
    });
    try {
      await call.joinCall();
      // A successful join with no call previously in progress means this user
      // started the call. Fires once, from the starter's client.
      if (!wasExistingCall) {
        analytics.track('call_action', {
          action: 'started',
          channelId: channelId(),
        });
      }
    } catch (e) {
      console.error('Call action failed', e);
    }
  };

  const start = async () => {
    if (call.isJoining()) return;
    // On mobile a call action is easy to hit by accident, and starting a
    // call rings everyone in the channel — confirm through a drawer first.
    // Joining a call that's already ringing is deliberate and disturbs no
    // one, so it goes straight through.
    if (isMobile() && !isCallInProgress()) {
      const confirmed = await confirmDialog(
        () => ({
          title: confirmTitle(),
          body: confirmBody(),
          tone: 'success' as const,
          confirmLabel: (
            <>
              <PhoneIcon class="size-5" />
              Start call
            </>
          ),
        }),
        { owner }
      );
      if (!confirmed) return;
    }
    await joinCall();
  };

  return {
    start,
    isCallInProgress,
    isInThisChannel: call.isInThisChannel,
  };
}
