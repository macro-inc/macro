import { throwOnErr } from '@core/util/maybeResult';
import { useLeaveCallMutation } from '@queries/call/call';
import { queryClient } from '@queries/client';
import { callServiceClient } from '@service-call/client';
import { useMutation } from '@tanstack/solid-query';
import { RoomEvent } from 'livekit-client';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { useCallContext } from './CallContext';
import { endCallKitCall, registerCallKitCallEndedHandler } from './use-callkit';

type UseCallOptions = {
  /** Called after successfully joining a call. */
  onJoin?: () => void;
  /** Called when the call ends for any reason (user leave, disconnect, kicked, etc.). */
  onLeave?: () => void;
};

type JoinCallContext = {
  channelId: string;
};

const JOIN_TIMEOUT_MS = 15_000;

// Module-level guard: only one leave can be in flight at a time across all
// useCall() instances. Prevents a user-initiated leave and a concurrent
// CallKit call-ended event from both proceeding to disconnect+leaveMutation.
let leaveInFlight = false;

/**
 * Hook that orchestrates joining/leaving calls by combining
 * the API mutations with the LiveKit room connection.
 *
 * Join is implemented as a single TanStack mutation so optimistic UI, timeout,
 * rollback, and server cleanup stay in onMutate / onError / onSuccess.
 */
export function useCall(channelId: () => string, options?: UseCallOptions) {
  const callCtx = useCallContext();
  const leaveMutation = useLeaveCallMutation();

  // Track the disconnect listener so we can swap it when the room changes.
  let cleanupDisconnectListener: (() => void) | null = null;

  function attachDisconnectListener() {
    cleanupDisconnectListener?.();
    cleanupDisconnectListener = null;

    const room = callCtx.room();
    if (!room) return;

    const handleDisconnect = () => options?.onLeave?.();
    room.on(RoomEvent.Disconnected, handleDisconnect);
    cleanupDisconnectListener = () =>
      room.off(RoomEvent.Disconnected, handleDisconnect);
  }

  // If the call is already active for this channel (e.g. the user navigated
  // away and came back), eagerly attach the disconnect listener so onLeave
  // fires when the call ends.
  if (callCtx.isInCall() && callCtx.activeChannelId() === channelId()) {
    attachDisconnectListener();
  }

  onCleanup(() => cleanupDisconnectListener?.());

  createEffect(() => {
    if (!callCtx.isInCall() || callCtx.activeChannelId() !== channelId())
      return;

    const unregister = registerCallKitCallEndedHandler(() =>
      leaveCall({ endNativeCall: false }).catch((e) =>
        console.error('callkit: failed to leave ended call', e)
      )
    );

    onCleanup(unregister);
  });

  /** Cleared in `joinCall` `finally` + safety timer so Try again never stays disabled if TanStack pending glitches. */
  const [joinUiPending, setJoinUiPending] = createSignal(false);

  let cancelCurrentJoin: () => void = () => {};

  const joinCallMutation = useMutation(() => ({
    mutationFn: async (id: string) => {
      let cancelled = false;
      cancelCurrentJoin = () => {
        cancelled = true;
      };

      const doConnect = async () => {
        // Call the join API directly so a timed-out join attempt cannot leave
        // `useJoinCallMutation` stuck pending and block the next retry.
        const [tokenResponse] = await Promise.all([
          throwOnErr(() => callServiceClient.getOrCreateCall(id)),
          new Promise<void>((resolve) => setTimeout(resolve, 300)),
        ]);
        if (cancelled) return;
        await callCtx.connect(tokenResponse);
      };

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Connection timed out')),
          JOIN_TIMEOUT_MS
        )
      );

      await Promise.race([doConnect(), timeout]);
    },
    onMutate: (id: string): JoinCallContext => {
      cancelCurrentJoin();
      callCtx.beginOptimisticJoin(id);
      options?.onJoin?.();
      return { channelId: id };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['call', 'active'] });
      attachDisconnectListener();
    },
    // Keep this handler synchronous: we undo the optimistic join and show the
    // error message right away. LiveKit disconnect and the server leave call
    // run in a fire-and-forget async block — on flaky networks those can take
    // forever, and if we awaited them here TanStack would keep the mutation
    // pending and the Try again button would stay stuck.
    onError: (_err, channelId: string, _ctx: JoinCallContext | undefined) => {
      cancelCurrentJoin();
      callCtx.rollbackOptimisticJoin();
      callCtx.setJoinError(
        'Unable to join the call. Please check your connection.'
      );
      void (async () => {
        try {
          await callCtx.disconnect();
        } catch (e) {
          console.error('join error recovery: disconnect failed', e);
        }
        try {
          await leaveMutation.mutateAsync(channelId);
        } catch (e) {
          console.error('join error recovery: leave server state failed', e);
        }
      })();
    },
  }));

  const joinCall = async () => {
    setJoinUiPending(true);
    const safetyMs = JOIN_TIMEOUT_MS + 5_000;
    const safetyTimer = globalThis.setTimeout(
      () => setJoinUiPending(false),
      safetyMs
    );
    try {
      await joinCallMutation.mutateAsync(channelId());
    } finally {
      globalThis.clearTimeout(safetyTimer);
      setJoinUiPending(false);
    }
  };

  async function leaveCall(leaveOptions?: { endNativeCall?: boolean }) {
    if (leaveInFlight) return;
    leaveInFlight = true;
    const id = channelId();
    // Detach before disconnect so the RoomEvent.Disconnected handler
    // doesn't double-fire onLeave.
    cleanupDisconnectListener?.();
    cleanupDisconnectListener = null;
    // Dismiss the native CallKit call sheet if the user left from within the app.
    // When the leave is initiated by CXEndCallAction, the native sheet is already
    // ending, so avoid sending a second native end request back to CallKit.
    // Isolated try/catch so a CallKit dismissal failure never skips disconnect.
    try {
      if (leaveOptions?.endNativeCall !== false) {
        try {
          await endCallKitCall();
        } catch (e) {
          console.error('callkit: failed to dismiss call sheet', e);
        }
      }
      try {
        await callCtx.disconnect();
        options?.onLeave?.();
      } finally {
        await leaveMutation.mutateAsync(id);
      }
    } finally {
      leaveInFlight = false;
    }
  }

  return {
    joinCall,
    leaveCall,
    // Rely on `joinUiPending` (finally + safety timer) so the button is not
    // gated on `joinCallMutation.isPending`, which can stick true in edge cases.
    isJoining: () => joinUiPending(),
    isLeaving: () => leaveMutation.isPending,
    isInCall: callCtx.isInCall,
    isInThisChannel: () =>
      callCtx.isInCall() && callCtx.activeChannelId() === channelId(),
    joinError: callCtx.joinError,
    callCtx,
  };
}
