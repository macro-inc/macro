import { useToggleShareWithTeamMutation } from '@queries/call/call';
import { useCallContext } from './CallContext';

/**
 * Returns a handler that flips the active call's `shared_with_team` flag and
 * mirrors the new value into the local call store. No-op when there's no
 * active call.
 */
export function useToggleShareWithTeam() {
  const callCtx = useCallContext();
  const mutation = useToggleShareWithTeamMutation();
  return async () => {
    const callId = callCtx.activeCallId();
    if (!callId) return;
    const newValue = await mutation.mutateAsync(callId);
    callCtx.setSharedWithTeam(newValue);
  };
}
