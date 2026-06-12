import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { isMobile } from '@core/mobile/isMobile';
import PhoneIcon from '@icon/wide-call.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { getCallJoinTab, getCallLeaveTab } from './call-tabs';
import { useCall } from './use-call';

export function ChannelCallButton(props: { channelId: string }) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
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
        variant={isMobile() ? 'ghost' : isCallInProgress() ? 'success' : 'base'}
        size="sm"
        depth={2}
        class={cn(!isCallInProgress() && !isMobile() && 'bg-surface', isMobile() && 'active:bg-transparent')}
      >
        <PhoneIcon />
        <span>{label()}</span>
      </Button>
    </Show>
  );
}
