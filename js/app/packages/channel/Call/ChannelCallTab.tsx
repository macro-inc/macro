import { type Accessor, Show, onCleanup, onMount } from 'solid-js';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { useCallContext } from './CallContext';
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
  const callCtx = useCallContext();
  const { setActiveTab } = useChannelTab();

  // Same intent as NewChannelBlockAdapter’s effect, but runs on tab content
  // mount so `isCallPage()` is true on the first paint (avoids expand flash).
  onMount(() => {
    callCtx.syncCallPageTab(props.channelId, true);
  });
  onCleanup(() => {
    callCtx.syncCallPageTab(props.channelId, false);
  });

  // Match ChannelCallButton / ChannelCallAutoJoin so leaving from the
  // overlay (or disconnect) switches back to Messages — not only when
  // the join was initiated from the header button.
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab('call'),
    onLeave: () => setActiveTab(DEFAULT_CHANNEL_TAB),
  });

  const handleRetry = async () => {
    try {
      await call.joinCall();
    } catch {
      // joinError is set inside useCall
    }
  };

  return (
    <Show
      when={() => call.isInThisChannel()}
      fallback={
        <Show
          when={call.joinError()}
          fallback={
            <Show when={props.pendingJoin?.()}>
              <div class="flex size-full items-center justify-center text-ink-muted">
                Joining call...
              </div>
            </Show>
          }
        >
          <div class="flex size-full flex-col items-center justify-center gap-3 text-ink-muted">
            <p>{call.joinError()}</p>
            <button
              onClick={handleRetry}
              class="rounded-lg bg-surface-2 px-4 py-2 text-sm text-ink hover:bg-surface-3 transition-colors"
            >
              Try again
            </button>
          </div>
        </Show>
      }
    >
      <CallOverlay onLeave={call.leaveCall} />
    </Show>
  );
}
