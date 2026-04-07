import { Show } from 'solid-js';
import { useCall } from './useCall';
import { CallOverlay } from './CallOverlay';

export function ChannelCallTab(props: { channelId: string }) {
  const call = useCall(() => props.channelId);

  return (
    <Show when={call.isInThisChannel()}>
      <CallOverlay onLeave={call.leaveCall} />
    </Show>
  );
}
