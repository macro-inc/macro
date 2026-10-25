import { analytics } from '@app/lib/analytics';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import {
  useChannel,
  useChannelName,
  useChannelType,
} from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import PhoneIcon from '@phosphor/phone-call.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { ChannelTypeEnum } from '@service-storage/client';
import { confirmDialog } from '@ui';
import { createMemo, getOwner } from 'solid-js';
import { CallParticipantAvatars } from './CallParticipantAvatars';
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
  const channel = useChannel(channelId());
  const userId = useUserId();
  const participantIds = createMemo(() => {
    const currentUser = userId();
    return [
      ...(currentUser ? [currentUser] : []),
      ...(channel()?.participants ?? [])
        .filter((participant) => participant.user_id !== currentUser)
        .map((participant) => participant.user_id),
    ];
  });
  const channelName = useChannelName(channelId());
  const channelType = useChannelType(channelId());
  const isDm = () => channelType() === ChannelTypeEnum.DirectMessage;

  // Captured now so the confirmation drawer opened from a click handler
  // inherits the caller's lifetime (navigating away closes it).
  const owner = getOwner();

  const confirmTitle = () => {
    const name = channelName();
    if (!name) return 'Start a call?';
    return isDm() ? `Start a call with ${name}` : `Start a call in ${name}`;
  };

  const confirmBody = () =>
    isDm()
      ? 'They’ll receive a notification to join.'
      : 'Everyone in the channel will be notified.';

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
          mobileHero: <CallParticipantAvatars ids={participantIds()} />,
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
