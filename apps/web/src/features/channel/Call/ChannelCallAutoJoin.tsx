import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, untrack } from 'solid-js';
import type { CallJoinIntent } from './call-lifecycle';
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
  pendingJoinCall: Accessor<CallJoinIntent | undefined>;
  onHandled: () => void;
  /** Wait for metadata; agent DMs cannot host calls. */
  canCall?: Accessor<boolean | undefined>;
}) {
  const { setActiveTab } = useChannelTab();
  // Mirror ChannelCallButton's tab-sync behavior so leaving via the
  // CallOverlay (or a disconnect) returns the user to the default tab
  // even when the join was triggered here instead of via the button.
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });
  let attemptedIntent: CallJoinIntent | undefined;

  async function join(intent: CallJoinIntent) {
    try {
      await call.joinCall('deep_link', intent);
    } catch (error) {
      console.error('Auto-join call failed', error);
    } finally {
      // A newer navigation request owns its own completion.
      if (props.pendingJoinCall() === intent) props.onHandled();
    }
  }

  createEffect(() => {
    const intent = props.pendingJoinCall();
    if (!intent || intent === attemptedIntent) return;
    const canCall = props.canCall ? props.canCall() : true;
    if (canCall === undefined) return;
    if (!canCall) {
      setActiveTab(getCallLeaveTab());
      props.onHandled();
      return;
    }

    // Leave a newer target pending until the current transition settles.
    // Read the lifecycle outside untrack so completion retries this effect.
    if (call.isJoining() || call.isLeaving()) return;

    untrack(() => {
      if (!ENABLE_CALLS) {
        props.onHandled();
        return;
      }
      attemptedIntent = intent;
      fireAndForget(join(intent), 'channel-call');
    });
  });

  return null;
}
