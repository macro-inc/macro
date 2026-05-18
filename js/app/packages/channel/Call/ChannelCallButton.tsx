import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import PhoneIcon from '@icon/wide-call.svg';
import PhoneDisconnectIcon from '@icon/wide-call-disconnect.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { useCall } from './use-call';

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
    return 'Start Call';
  };

  const label = () => {
    if (call.isInThisChannel()) return 'Leave';
    if (isCallInProgress()) return 'Join';
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
      variant="base"
      size="sm"
      depth={2}
      class={cn(
        'bg-surface',
        isHighlighted() &&
          'bg-accent/20 hover:bg-accent/30 text-accent border-accent/30'
      )}
    >
      <Show when={call.isInThisChannel()} fallback={<PhoneIcon />}>
        <PhoneDisconnectIcon />
      </Show>
      <span>{label()}</span>
    </Button>
  );
}
