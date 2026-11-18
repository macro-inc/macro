import { useIsAuthenticated } from '@core/auth';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  refreshJoinedChannel,
  useCancelChannelAccessRequestMutation,
  useRequestChannelAccessMutation,
} from '@queries/channel/access-requests';
import type { ChannelAccessRequest } from '@service-storage/generated/schemas/channelAccessRequest';
import { Button } from '@ui';
import { createEffect, createMemo, Match, on, Show, Switch } from 'solid-js';
import { ChannelUnavailable } from './components/ChannelUnavailable';
import { RequestToJoinPanel } from './components/RequestToJoinPanel';
import { requestToJoinView } from './core/access-request';
import { useMyChannelAccessRequestState } from './queries/my-access-request';

/** A channel the viewer cannot read, with a way to ask its members to join. */
export function ChannelAccessDenied(props: {
  channelId: string;
  onRefreshChannel: () => void;
}) {
  const authenticated = useIsAuthenticated();
  const state = useMyChannelAccessRequestState(
    () => props.channelId,
    () => !!authenticated()
  );
  const unavailable = createMemo<string | undefined>((previous) => {
    if (!authenticated()) return;
    const loaded = state.read();
    if (loaded.status === 'not-found') return props.channelId;
    // Refetching a 404 without cached data returns the query to pending.
    if (loaded.status !== 'ready' && previous === props.channelId)
      return previous;
  });
  const current = () => {
    const loaded = state.read();
    return loaded.status === 'ready' ? loaded.state : undefined;
  };
  const view = () => {
    const loaded = current();
    return loaded && requestToJoinView(loaded);
  };
  const ask = useRequestChannelAccessMutation();
  const withdraw = useCancelChannelAccessRequestMutation();
  const retry = () => {
    fireAndForget(state.refresh(), 'channel-access-request');
    props.onRefreshChannel();
  };

  // Only an approval seen while waiting opens the channel: an older approval
  // means the viewer has since left, and reloading would not let them in.
  createEffect(
    on(
      () => current()?.request,
      (request, _previousInput, previous: ChannelAccessRequest | undefined) => {
        // A failed read must not erase the last confirmed pending request.
        if (!request) return previous;
        if (
          previous?.status !== 'pending' ||
          request?.id !== previous.id ||
          request.status !== 'approved'
        )
          return request;
        fireAndForget(refreshJoinedChannel(), 'channel-access-request');
        props.onRefreshChannel();
        return request;
      }
    )
  );

  return (
    <Show
      when={!unavailable()}
      fallback={
        <ChannelUnavailable busy={state.refreshing()} onRetry={retry} />
      }
    >
      <Unauthorized noun="channel">
        <Show when={authenticated()}>
          <Switch>
            <Match when={state.read().status === 'loading'}>
              <span role="status" class="mt-6 text-sm text-ink-muted">
                Loading access request…
              </span>
            </Match>
            <Match when={state.read().status === 'error'}>
              <div
                role="alert"
                class="mt-6 flex items-center gap-2 text-sm text-ink-muted"
              >
                <span>Could not load your request to join.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state.refreshing()}
                  onClick={retry}
                >
                  Retry
                </Button>
              </div>
            </Match>
            <Match when={view()}>
              {(view) => (
                <RequestToJoinPanel
                  view={view()}
                  busy={ask.isPending || withdraw.isPending}
                  onAsk={() => ask.mutate({ channelId: props.channelId })}
                  onWithdraw={() =>
                    withdraw.mutate({ channelId: props.channelId })
                  }
                />
              )}
            </Match>
          </Switch>
        </Show>
      </Unauthorized>
    </Show>
  );
}
