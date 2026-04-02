import { useJoinCallMutation, useLeaveCallMutation } from '@queries/call/call';
import { useCallContext } from './CallContext';

/**
 * Hook that orchestrates joining/leaving calls by combining
 * the API mutations with the LiveKit room connection.
 */
export function useCall(channelId: () => string) {
  const callCtx = useCallContext();
  const joinMutation = useJoinCallMutation();
  const leaveMutation = useLeaveCallMutation();

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
  }

  async function leaveCall() {
    const id = channelId();
    try {
      await callCtx.disconnect();
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
