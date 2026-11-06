import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useToggleShareWithTeamMutation } from '@queries/call/call';
import { useCallContext } from './CallContext';
import { useCallTeamShareChange } from './use-call-team-share-change';

/**
 * Team sharing controls for the active call.
 *
 * `toggle` proposes flipping the live call's share-with-team toggle through
 * `POST /call/record/{id}/share-with-team/toggle` and mirrors the current value
 * into the local call store. Any participant with edit access may propose it;
 * it takes effect once the other participants approve, and becomes canonical
 * team sharing (view for the creator's team) when the call is archived.
 * Standalone calls never enter team memory.
 */
export function useActiveCallTeamShare() {
  const callCtx = useCallContext();
  const mutation = useToggleShareWithTeamMutation();
  const change = useCallTeamShareChange(() => callCtx.activeCallId() ?? '');

  const canToggle = () =>
    callCtx.activeCallId() !== null && callCtx.activeChannelId() !== null;

  const toggle = async () => {
    const callId = callCtx.activeCallId();
    if (!callId || !canToggle()) return;
    const requested = !callCtx.isSharedWithTeam();
    const newValue = await mutation.mutateAsync(callId);
    callCtx.setSharedWithTeam(newValue);
    if (newValue !== requested) {
      toast.success(t('calls.teamShareRequestSent'));
    }
  };

  const answer = async (approve: boolean) => {
    const state = await change.answer(approve);
    if (state && callCtx.activeCallId() === change.callId()) {
      callCtx.setSharedWithTeam(state.shared);
    }
  };

  return {
    toggle,
    canToggle,
    isPending: () => mutation.isPending,
    change: { ...change, answer },
  };
}
