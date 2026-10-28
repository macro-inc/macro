import { useToggleShareWithTeamMutation } from '@queries/call/call';
import { useCallContext } from './CallContext';

/**
 * Team sharing controls for the active call.
 *
 * `toggle` flips the live call's share-with-team toggle through
 * `POST /call/record/{id}/share-with-team/toggle` and mirrors the new value
 * into the local call store. Any participant with edit access may flip it;
 * the toggle becomes canonical team sharing (view for the creator's team)
 * when the call is archived. Standalone calls never enter team memory.
 */
export function useActiveCallTeamShare() {
  const callCtx = useCallContext();
  const mutation = useToggleShareWithTeamMutation();

  const canToggle = () =>
    callCtx.activeCallId() !== null && callCtx.activeChannelId() !== null;

  const toggle = async () => {
    const callId = callCtx.activeCallId();
    if (!callId || !canToggle()) return;
    const newValue = await mutation.mutateAsync(callId);
    callCtx.setSharedWithTeam(newValue);
  };

  return { toggle, canToggle, isPending: () => mutation.isPending };
}
