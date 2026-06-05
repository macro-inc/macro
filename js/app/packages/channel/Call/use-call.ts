import { useChannelsContext } from '@core/context/channels';
import { throwOnErr } from '@core/util/result';
import {
  invalidateActiveCallQueries,
  useLeaveCallMutation,
} from '@queries/call/call';
import { callServiceClient } from '@service-call/client';
import { useMutation } from '@tanstack/solid-query';
import { DisconnectReason, RoomEvent } from 'livekit-client';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { useCallContext } from './CallContext';
import { registerCallKitCallEndedHandler } from './use-callkit';

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
const AUTO_REJOIN_DELAY_MS = 750;
const MAX_AUTO_REJOIN_ATTEMPTS = 1;

type ActiveJoinAttempt = {
  channelId: string;
  promise: Promise<void>;
};

function shouldAutoRejoin(reason?: DisconnectReason) {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
    case DisconnectReason.DUPLICATE_IDENTITY:
    case DisconnectReason.PARTICIPANT_REMOVED:
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return false;
    default:
      return true;
  }
}

// Module-level guard: only one join can be in flight at a time across all
// useCall() instances. The call button, call tab, auto-join flow, and in-call
// panel can all mount their own hook; without this, two components can race and
// call room.connect() while LiveKit is already reconnecting.
let activeJoinAttempt: ActiveJoinAttempt | null = null;

// Module-level guard: only one leave can be in flight at a time across all
// useCall() instances. Prevents a user-initiated leave and a concurrent
// CallKit call-ended event from both proceeding to disconnect+leaveMutation.
let leaveInFlight = false;

/**
 * Hook that orchestrates joining/leaving calls by combining
 * the API mutations with the platform call session controller.
 *
 * Join is implemented as a single TanStack mutation so optimistic UI, timeout,
 * rollback, and server cleanup stay in onMutate / onError / onSuccess.
 */
export function useCall(channelId: () => string, options?: UseCallOptions) {
  const callCtx = useCallContext();
  const channelsCtx = useChannelsContext();
  const leaveMutation = useLeaveCallMutation();

  // Track the disconnect listener so we can swap it when the room changes.
  let cleanupDisconnectListener: (() => void) | null = null;
  let autoRejoinAttempts = 0;
  let autoRejoinTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  function clearAutoRejoinTimer() {
    if (!autoRejoinTimer) return;
    globalThis.clearTimeout(autoRejoinTimer);
    autoRejoinTimer = null;
  }

  function scheduleAutoRejoin(reason?: DisconnectReason) {
    if (leaveInFlight) return;

    if (!shouldAutoRejoin(reason)) {
      options?.onLeave?.();
      return;
    }

    if (autoRejoinAttempts >= MAX_AUTO_REJOIN_ATTEMPTS) {
      options?.onLeave?.();
      return;
    }

    autoRejoinAttempts += 1;
    callCtx.setJoinError('Call disconnected. Reconnecting…');
    autoRejoinTimer = globalThis.setTimeout(() => {
      autoRejoinTimer = null;
      joinCall().catch((e) => console.error('auto-rejoin call failed', e));
    }, AUTO_REJOIN_DELAY_MS);
  }

  function attachDisconnectListener() {
    cleanupDisconnectListener?.();
    cleanupDisconnectListener = null;

    const room = callCtx.room();
    if (!room) return;

    const handleDisconnect = (reason?: DisconnectReason) => {
      // This listener is detached before explicit leave, so reaching this path
      // means LiveKit gave up on recovery. Try one hard rejoin with a fresh
      // token/Room instead of immediately dumping the user out of the call UI.
      cleanupDisconnectListener?.();
      cleanupDisconnectListener = null;
      scheduleAutoRejoin(reason);
    };
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

  onCleanup(() => {
    cleanupDisconnectListener?.();
    clearAutoRejoinTimer();
  });

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
        if (!callCtx.shouldRequestSessionToken(id)) {
          callCtx.rollbackOptimisticJoin();
          return;
        }

        // Call the join API directly so a timed-out join attempt cannot leave
        // `useJoinCallMutation` stuck pending and block the next retry.
        const [tokenResponse] = await Promise.all([
          throwOnErr(() => callServiceClient.getOrCreateCall(id)),
          new Promise<void>((resolve) => setTimeout(resolve, 300)),
        ]);
        if (cancelled) return;

        await callCtx.connectSession(tokenResponse, {
          channelTitle:
            channelsCtx.channelsById()[tokenResponse.channelId]?.name ?? null,
        });
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
      autoRejoinAttempts = 0;
      clearAutoRejoinTimer();
      void invalidateActiveCallQueries();
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
          await callCtx.disconnectSession({ endNativeCall: false });
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
    clearAutoRejoinTimer();
    const id = channelId();
    const existing = activeJoinAttempt;
    if (existing && existing.channelId !== id) {
      throw new Error('Already joining another call');
    }

    const joinPromise = existing?.promise ?? joinCallMutation.mutateAsync(id);
    if (!existing) {
      activeJoinAttempt = { channelId: id, promise: joinPromise };
    }

    setJoinUiPending(true);
    const safetyMs = JOIN_TIMEOUT_MS + 5_000;
    const safetyTimer = globalThis.setTimeout(
      () => setJoinUiPending(false),
      safetyMs
    );
    try {
      await joinPromise;
    } finally {
      if (activeJoinAttempt?.promise === joinPromise) {
        activeJoinAttempt = null;
      }
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
    clearAutoRejoinTimer();
    try {
      try {
        await callCtx.disconnectSession(leaveOptions);
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
