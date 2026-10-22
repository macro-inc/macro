import { useIsAuthenticated } from '@core/auth';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  refreshJoinedChannel,
  useCancelChannelAccessRequestMutation,
  useMyChannelAccessRequestQuery,
  useRequestChannelAccessMutation,
} from '@queries/channel/access-requests';
import { createEffect, on, Show } from 'solid-js';
import { RequestToJoinPanel } from './components/RequestToJoinPanel';
import { requestToJoinView } from './core/access-request';

/** A channel the viewer cannot read, with a way to ask its members to join. */
export function ChannelAccessDenied(props: {
  channelId: string;
  onAccessGranted: () => void;
}) {
  const authenticated = useIsAuthenticated();
  const state = useMyChannelAccessRequestQuery(
    () => props.channelId,
    () => !!authenticated()
  );
  const current = () => (state.isPending ? undefined : state.data);
  const view = () => {
    const loaded = current();
    return loaded && requestToJoinView(loaded);
  };
  const ask = useRequestChannelAccessMutation();
  const withdraw = useCancelChannelAccessRequestMutation();

  // Only an approval seen while waiting opens the channel: an older approval
  // means the viewer has since left, and reloading would not let them in.
  createEffect(
    on(
      () => current()?.request,
      (request, previous) => {
        if (
          previous?.status !== 'pending' ||
          request?.id !== previous.id ||
          request.status !== 'approved'
        )
          return;
        fireAndForget(refreshJoinedChannel(), 'channel-access-request');
        props.onAccessGranted();
      }
    )
  );

  return (
    <Unauthorized title="You don't have access to this channel">
      <Show when={view()}>
        {(view) => (
          <RequestToJoinPanel
            view={view()}
            busy={ask.isPending || withdraw.isPending}
            onAsk={() => ask.mutate({ channelId: props.channelId })}
            onWithdraw={() => withdraw.mutate({ channelId: props.channelId })}
          />
        )}
      </Show>
    </Unauthorized>
  );
}
