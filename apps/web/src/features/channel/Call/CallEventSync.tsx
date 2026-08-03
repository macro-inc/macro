import { useCallContext } from './CallContext';
import { createCallEventsEffect } from './call-events';

/**
 * Applies connection-gateway events that mutate active-call state held in
 * `CallContext`. Must be rendered inside `<CallProvider />`.
 *
 * Handled events:
 *  - `call_share_with_team_toggled` — keeps `isSharedWithTeam` in sync when
 *    the flag is flipped by another participant (or by the same user on a
 *    different device). Skipped when the payload's `call_id` does not match
 *    the currently active call, since the flag is only tracked while the
 *    user is in that call.
 */
export function CallEventSync() {
  const callCtx = useCallContext();

  createCallEventsEffect({
    onShareWithTeamToggled: ({ callId, shareWithTeam }) => {
      if (callId !== callCtx.activeCallId()) return;
      callCtx.setSharedWithTeam(shareWithTeam);
    },
  });

  return null;
}
