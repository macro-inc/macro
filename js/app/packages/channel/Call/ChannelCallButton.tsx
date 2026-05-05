import { Show } from 'solid-js';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import { Button } from '@ui/components/Button';
import PhoneIcon from '@macro-icons/wide/call.svg';
import PhoneDisconnectIcon from '@macro-icons/wide/call-disconnect.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { useCall } from './use-call';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

export function ChannelCallButton(props: { channelId: string }) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab('call'),
    onLeave: () => setActiveTab(DEFAULT_CHANNEL_TAB),
  });

  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const isCallInProgress = () => !!activeCallQuery.data;
  const isHighlighted = () => call.isInThisChannel() || isCallInProgress();

  const isPending = () => call.isLeaving();

  const tooltip = () => {
    if (call.isInThisChannel()) return 'Leave Call';
    if (isCallInProgress()) return 'Join Call';
    return 'Call';
  };

  const handleClick = async () => {
    if (call.isJoining() || call.isLeaving()) return;

    try {
      if (call.isInThisChannel()) {
        await call.leaveCall();
      } else {
        await call.joinCall();
      }
    } catch (e) {
      console.error('Call action failed', e);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={isPending()}
      tooltip={tooltip()}
      class={
        isHighlighted()
          ? 'px-1 bg-accent/20 hover:bg-accent/30 text-accent-ink'
          : 'px-1'
      }
      size={isTouchDevice() ? 'icon-md' : 'icon-sm'}
    >
      <Show when={call.isInThisChannel()} fallback={<PhoneIcon />}>
        <PhoneDisconnectIcon />
      </Show>
    </Button>
  );
}
