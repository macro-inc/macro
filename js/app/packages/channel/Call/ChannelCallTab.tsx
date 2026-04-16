import { type Accessor, Show } from 'solid-js';
import { useCall } from './useCall';
import { CallOverlay } from './CallOverlay';

export function ChannelCallTab(props: {
  channelId: string;
  /**
   * When true, show a "Joining call…" placeholder if we aren't yet
   * connected to this channel's call. Used for auto-join flows (e.g.
   * `?join_call=true` deep links) so the tab can render meaningful
   * content before the join request lands.
   */
  pendingJoin?: Accessor<boolean>;
}) {
  const call = useCall(() => props.channelId);
  const showJoining = () =>
    call.isJoining() || (props.pendingJoin?.() ?? false);

  return (
    <Show
      when={call.isInThisChannel()}
      fallback={
        <Show when={showJoining()}>
          <div class="flex size-full items-center justify-center text-ink-muted">
            Joining call…
          </div>
        </Show>
      }
    >
      <CallOverlay onLeave={call.leaveCall} />
    </Show>
  );
}
