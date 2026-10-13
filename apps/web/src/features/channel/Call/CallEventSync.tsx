import {
  isCallSharedWithTeam,
  setCallRecordRefusalsCache,
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
    callCtx.setRecordingRefusedBy(current.oneOnOneRecordingRefusedBy);
  });

  createCallEventsEffect({
    onShareWithTeamToggled: ({ callId, shareWithTeam }) => {
      if (callId !== callCtx.activeCallId()) return;
      setCallRecordTeamShareCache(callId, shareWithTeam);
      callCtx.setSharedWithTeam(shareWithTeam);
    },
    onRecordingRefusalsChanged: ({ callId, refusedBy }) => {
      if (callId !== callCtx.activeCallId()) return;
      setCallRecordRefusalsCache(callId, refusedBy);
      callCtx.setRecordingRefusedBy(refusedBy);
    },
  });

  return null;
}
