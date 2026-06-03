import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { type Accessor, createEffect, untrack } from 'solid-js';
import { getCallJoinTab, getCallLeaveTab } from './call-tabs';
import { useCall } from './use-call';

/**
 * Auto-joins the call for this channel whenever `pendingJoinCall` flips to
 * true. Used to support deep-links like
 * `/app/channel/{channel_id}?join_call=true` that drop the user straight
 * into the call.
 *
 * Must be rendered inside `<CallProvider>` and `<ChannelTabProvider>`.
 */
export function ChannelCallAutoJoin(props: {
  channelId: string;
  pendingJoinCall: Accessor<boolean>;
  onHandled: () => void;
}) {
  const { setActiveTab } = useChannelTab();
  // Mirror ChannelCallButton's tab-sync behavior so leaving via the
  // CallOverlay (or a disconnect) returns the user to the default tab
  // even when the join was triggered here instead of via the button.
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });

  createEffect(() => {
    if (!props.pendingJoinCall()) return;

    untrack(() => {
      if (!ENABLE_CALLS()) {
        props.onHandled();
        return;
      }

      // If the user is mid-transition on this channel's call (e.g. they
      // clicked the call button at the same moment), let that flow win.
      if (call.isJoining() || call.isLeaving()) {
        props.onHandled();
        return;
      }

      if (call.isInThisChannel()) {
        setActiveTab(getCallJoinTab());
        props.onHandled();
        return;
      }

      call
        .joinCall()
        .catch((e) => console.error('Auto-join call failed', e))
        .finally(() => props.onHandled());
    });
  });

  return null;
}
