import {
  isCallSharedWithTeam,
  setCallRecordTeamShareCache,
  useCallRecordQuery,
} from '@queries/call/call';
import { createEffect } from 'solid-js';
import { useCallContext } from './CallContext';
import { createCallEventsEffect } from './call-events';

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
