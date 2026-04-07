import { useJoinCallMutation, useLeaveCallMutation } from '@queries/call/call';
import { RoomEvent } from 'livekit-client';
import { onCleanup } from 'solid-js';
import { useCallContext } from './CallContext';

type UseCallOptions = {
  /** Called after successfully joining a call. */
  onJoin?: () => void;
  /** Called when the call ends for any reason (user leave, disconnect, kicked, etc.). */
  onLeave?: () => void;
};

/**
 * Hook that orchestrates joining/leaving calls by combining
 * the API mutations with the LiveKit room connection.
 */
export function useCall(channelId: () => string, options?: UseCallOptions) {
  const callCtx = useCallContext();
  const joinMutation = useJoinCallMutation();
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

  onCleanup(() => cleanupDisconnectListener?.());

  async function joinCall() {
    const id = channelId();
    const tokenResponse = await joinMutation.mutateAsync(id);
    try {
      await callCtx.connect(tokenResponse);
    } catch (e) {
      // Roll back the backend join so it doesn't think we're in the call
      try {
        await leaveMutation.mutateAsync(id);
      } catch (leaveErr) {
        console.error(
          'Failed to roll back join after connect failure',
          leaveErr
        );
      }
      throw e;
    }
    attachDisconnectListener();
    options?.onJoin?.();
  }

  async function leaveCall() {
    const id = channelId();
    // Detach before disconnect so the RoomEvent.Disconnected handler
    // doesn't double-fire onLeave.
    cleanupDisconnectListener?.();
    cleanupDisconnectListener = null;
    try {
      await callCtx.disconnect();
      options?.onLeave?.();
    } finally {
      await leaveMutation.mutateAsync(id);
    }
  }

  return {
    joinCall,
    leaveCall,
    isJoining: () => joinMutation.isPending,
    isLeaving: () => leaveMutation.isPending,
    isInCall: callCtx.isInCall,
    isInThisChannel: () =>
      callCtx.isInCall() && callCtx.activeChannelId() === channelId(),
    callCtx,
  };
}
