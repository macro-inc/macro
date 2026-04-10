import { Show } from 'solid-js';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import { Button } from '@ui/components/Button';
import PhoneIcon from '@icon/regular/phone.svg';
import PhoneDisconnectIcon from '@icon/regular/phone-disconnect.svg';
import { useCall } from './useCall';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

export function ChannelCallButton(props: { channelId: string }) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab('call'),
    onLeave: () => setActiveTab(DEFAULT_CHANNEL_TAB),
  });

  const isPending = () => call.isJoining() || call.isLeaving();

  const handleClick = async () => {
    if (isPending()) return;
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
      tooltip={call.isInThisChannel() ? 'Leave Call' : 'Call'}
      class={
        call.isInThisChannel()
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
