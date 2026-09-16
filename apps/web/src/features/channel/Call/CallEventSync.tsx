import { isCallSharedWithTeam, useCallRecordQuery } from '@queries/call/call';
import { createEffect } from 'solid-js';
import { useCallContext } from './CallContext';
import { createCallEventsEffect } from './call-events';

/**
 * Keeps active-call state held in `CallContext` in sync with the server.
 * Must be rendered inside `<CallProvider />`.
 *
 *  - The call record seeds `isSharedWithTeam` from the canonical
 *    `teamShareAccessLevel` once the active call's record loads (creators
 *    without a team start unshared, so no default is assumed).
 *  - `call_share_with_team_toggled` — keeps `isSharedWithTeam` in sync when
 *    the creator changes it (possibly on a different device). Skipped when
 *    the payload's `call_id` does not match the currently active call, since
 *    the flag is only tracked while the user is in that call.
 */
export function CallEventSync() {
  const callCtx = useCallContext();
  const record = useCallRecordQuery(() => callCtx.activeCallId() ?? '');

  createEffect(() => {
    const current = record.data;
    if (!current || current.callId !== callCtx.activeCallId()) return;
    callCtx.setSharedWithTeam(isCallSharedWithTeam(current));
  });

  createCallEventsEffect({
    onShareWithTeamToggled: ({ callId, shareWithTeam }) => {
      if (callId !== callCtx.activeCallId()) return;
      callCtx.setSharedWithTeam(shareWithTeam);
    },
  });

  return null;
}
