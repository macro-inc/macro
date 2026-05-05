import { tryMacroId } from '@core/user';
import type { InCallPanelMember, UseInCallPanelResult } from './types';

export function profilePictureIdForMember(
  panel: UseInCallPanelResult,
  member: InCallPanelMember
): string | undefined {
  // LiveKit mutates participant fields on stable object refs — `room()` alone
  // does not invalidate. Re-read when connection or participant/track state changes.
  panel.callCtx.connectionState();
  panel.callCtx.trackVersion();

  if (member.kind === 'local') {
    const identity = panel.callCtx.room()?.localParticipant.identity;
    if (!identity) return undefined;
    return tryMacroId(identity) ?? identity;
  }
  return tryMacroId(member.participant.identity) ?? member.participant.identity;
}
