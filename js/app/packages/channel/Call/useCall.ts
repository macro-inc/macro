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
    await callCtx.connect(tokenResponse);
  }

  async function leaveCall() {
    await callCtx.disconnect();
    const id = channelId();
    await leaveMutation.mutateAsync(id);
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
