import { type Accessor, Match, Show, Switch } from 'solid-js';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { useCall } from './use-call';
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
  const { setActiveTab } = useChannelTab();

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
      // joinError is set inside useCall join mutation onError
    }
  };

  return (
    <Switch
      fallback={
        <div class="flex size-full flex-col items-center justify-center gap-3 text-ink-muted px-4">
          <p class="text-center text-sm">You’re not in this call yet.</p>
          <button
            type="button"
            onClick={() => void call.joinCall()}
            disabled={call.isJoining()}
            class="rounded-lg bg-surface-2 px-4 py-2 text-sm text-ink hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {call.isJoining() ? 'Connecting…' : 'Join call'}
          </button>
        </div>
      }
    >
      <Match when={call.isInThisChannel() && !call.joinError()}>
        <CallOverlay onLeave={call.leaveCall} />
      </Match>
      <Match when={call.joinError()}>
        <div class="flex size-full flex-col items-center justify-center gap-3 text-ink-muted px-4">
          <p class="text-center">{call.joinError()}</p>
          <Show when={call.isJoining()}>
            <p class="text-xs text-ink-extra-muted animate-pulse">
              Connecting…
            </p>
          </Show>
          <button
            type="button"
            onClick={handleRetry}
            disabled={call.isJoining()}
            class="rounded-lg bg-surface-2 px-4 py-2 text-sm text-ink hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            Try again
          </button>
        </div>
      </Match>
      <Match when={props.pendingJoin?.()}>
        <div class="flex size-full items-center justify-center text-ink-muted">
          Joining call...
        </div>
      </Match>
    </Switch>
  );
}
