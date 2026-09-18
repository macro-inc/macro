import { onCleanup } from 'solid-js';
import { useCallContext } from './CallContext';
import type { CallSessionDisconnectOptions } from './CallSessionController';

type UseCallOptions = {
  /** Select the call tab when Join is requested, including a refused join. */
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
