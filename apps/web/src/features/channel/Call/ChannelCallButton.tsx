import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneIcon from '@phosphor/phone-call.svg';
import { cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { Show } from 'solid-js';
import { CHANNEL_TOUR } from '../tour';
import { useStartChannelCall } from './use-start-channel-call';

export function ChannelCallButton(props: { channelId: string }) {
  const call = useStartChannelCall(() => props.channelId);

  const tooltip = () => (call.isCallInProgress() ? 'Join Call' : 'Start Call');
  const label = () => (call.isCallInProgress() ? 'Join' : 'Call');

  return (
    <Show when={!call.isInThisChannel()}>
      <HeaderActionButton
        ref={tourTarget(CHANNEL_TOUR.call)}
        onClick={() => fireAndForget(call.start(), 'channel-call')}
        tooltip={tooltip()}
        label={label()}
        icon={<PhoneIcon />}
        class={cn(call.isCallInProgress() && 'text-success')}
      />
    </Show>
  );
}
