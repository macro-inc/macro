import { onCleanup } from 'solid-js';
import { useCallContext } from './CallContext';
import type { CallSessionDisconnectOptions } from './CallSessionController';

type UseCallOptions = {
  /** Called when joining starts, so the view can select its call tab. */
  onJoin?: () => void;
  /** Called when this channel's call ends for any reason. */
  onLeave?: () => void;
};

/** A view of the provider's shared call lifecycle. */
export function useCall(channelId: () => string, options?: UseCallOptions) {
  const callCtx = useCallContext();
  const lifecycle = callCtx.callLifecycle;

  if (options?.onLeave) {
    onCleanup(
      lifecycle.onLeave((id) => {
        if (id === channelId()) options.onLeave?.();
      })
    );
  }

  return {
    joinCall: () => lifecycle.join(channelId(), options?.onJoin),
    leaveCall: (options?: CallSessionDisconnectOptions) =>
      lifecycle.leave(channelId(), options),
    isJoining: () => {
      const state = lifecycle.getState();
      return state.t === 'joining' && state.request.channelId === channelId();
    },
    isLeaving: () => {
      const state = lifecycle.getState();
      return state.t === 'leaving' && state.request.channelId === channelId();
    },
    isInCall: callCtx.isInCall,
    isInThisChannel: () =>
      callCtx.isInCall() && callCtx.activeChannelId() === channelId(),
    joinError: callCtx.joinError,
    callCtx,
  };
}
