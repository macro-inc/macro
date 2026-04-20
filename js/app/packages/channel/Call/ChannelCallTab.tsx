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

  return (
    <Show
      when={call.isInThisChannel()}
      fallback={
        // This fallback now only shows for the brief moment before
        // beginOptimisticJoin fires (e.g. deep-link auto-join where
        // pendingJoin is set but joinCall hasn't been called yet)
        <Show when={props.pendingJoin?.()}>
          <div class="flex size-full items-center justify-center text-ink-muted">
            Joining call...
          </div>
        </Show>
      }
    >
      <CallOverlay onLeave={call.leaveCall} />
    </Show>
  );
}
