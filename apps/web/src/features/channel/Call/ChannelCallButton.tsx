import { HeaderActionButton } from '@components/app/HeaderActionButton';
import PhoneIcon from '@icon/system/regular/phone-call.svg';
import { cn } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { type JSX, Show } from 'solid-js';
import { CHANNEL_TOUR } from '../tour';
import { useStartChannelCall } from './use-start-channel-call';

export function ChannelCallButton(props: {
  channelId: string;
  trailing?: JSX.Element;
}) {
  const call = useStartChannelCall(() => props.channelId);

  const tooltip = () => (call.isCallInProgress() ? 'Join Call' : 'Start Call');
  const label = () => (call.isCallInProgress() ? 'Join' : 'Call');

  return (
    <Show when={!call.isInThisChannel()}>
      <HeaderActionButton
        ref={tourTarget(CHANNEL_TOUR.call)}
        onClick={() => void call.start()}
        tooltip={tooltip()}
        label={label()}
        textOnly
        icon={<PhoneIcon />}
        class={cn(call.isCallInProgress() && 'text-success')}
      />
      {props.trailing}
    </Show>
  );
}
