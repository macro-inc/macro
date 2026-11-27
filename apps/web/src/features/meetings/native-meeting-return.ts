import { getActiveMeetingPath } from '@channel/Call/call-link';
import { registerNativeMeetingOpener } from '@channel/Call/use-callkit';
import { useNavigate } from '@solidjs/router';
import { onCleanup } from 'solid-js';
import { useMeetingSessionOwnerOptional } from './context/meeting-session-owner';

/**
 * Opening a meeting's native call screen (its drawer or Picture in Picture)
 * returns to the meeting's page, as a channel call's returns to its channel.
 * Mount once inside the router.
 */
export function useNativeMeetingReturn() {
  const owner = useMeetingSessionOwnerOptional();
  const navigate = useNavigate();
  if (!owner) return;

  onCleanup(
    registerNativeMeetingOpener((callId) => {
      const meeting = owner.forCall(callId);
      if (!meeting) return false;
      navigate(getActiveMeetingPath(meeting.shareToken));
      return true;
    })
  );
}
