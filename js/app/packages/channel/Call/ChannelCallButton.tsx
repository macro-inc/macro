import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import PhoneIcon from '@icon/wide-call.svg';
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

  const tooltip = () => (isCallInProgress() ? 'Join Call' : 'Start Call');
  const label = () => (isCallInProgress() ? 'Join' : 'Call');

  const handleClick = async () => {
    if (call.isJoining()) return;
    try {
      await call.joinCall();
    } catch (e) {
      console.error('Call action failed', e);
    }
  };

  return (
    <Show when={!call.isInThisChannel()}>
      <Button
        onClick={handleClick}
        tooltip={tooltip()}
        variant="base"
        size="sm"
        depth={2}
        class={cn(
          'bg-surface',
          isCallInProgress() &&
            'bg-accent/20 hover:bg-accent/30 text-accent border-accent/30'
        )}
      >
        <PhoneIcon />
        <span>{label()}</span>
      </Button>
    </Show>
  );
}
