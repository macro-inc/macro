import {
  isCallSharedWithTeam,
  setCallRecordTeamShareCache,
  useCallRecordQuery,
} from '@queries/call/call';
import { createEffect } from 'solid-js';
import { useCallContext } from './CallContext';
import { createCallEventsEffect } from './call-events';

/**
 * Keeps active-call state held in `CallContext` in sync with the server.
 * Must be rendered inside `<CallProvider />`.
 *
 *  - The call record seeds `isSharedWithTeam` from the live call's pending
 *    share-with-team toggle once the active call's record loads.
 *  - `call_share_with_team_toggled` keeps `isSharedWithTeam` and the record
 *    query cache in sync when another participant flips the toggle, or the
 *    same user does on a different device. Skipped when the payload's
 *    `call_id` does not match the currently active call, since the flag is
 *    only tracked while the user is in that call.
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
      setCallRecordTeamShareCache(callId, shareWithTeam);
      callCtx.setSharedWithTeam(shareWithTeam);
    },
  });

  return null;
}
