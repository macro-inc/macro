import { useUserId } from '@core/context/user';
import type { Accessor } from 'solid-js';
import { type CallState, useCallContextOptional } from './CallContext';

export type SpeakingCall = { callId?: string; channelId?: string };

function matchesCall(
  call: CallState | undefined,
  target: SpeakingCall
): call is CallState {
  if (!call?.isInCall() || (!target.callId && !target.channelId)) return false;
  if (target.callId && target.callId !== call.activeCallId()) return false;
  if (target.channelId && target.channelId !== call.activeChannelId())
    return false;
  return true;
}

/** Only the joined room supplies live speech; call records do not. */
export function useCallSpeaking() {
  const call = useCallContextOptional();
  return (target: SpeakingCall) => {
    if (!matchesCall(call, target)) return false;
    return (
      call.isLocalSpeaking() ||
      Array.from(call.remoteParticipants().values()).some(
        (participant) =>
          !participant.isAgent && call.isParticipantSpeaking(participant)
      )
    );
  };
}

/** Resolve participant identities against the same room that owns the call. */
export function useParticipantSpeaking(target: Accessor<SpeakingCall>) {
  const call = useCallContextOptional();
  if (!call) return () => false;
  const currentUserId = useUserId();
  return (userId: string) => {
    if (!matchesCall(call, target())) return false;
    const localId = call.room()?.localParticipant.identity || currentUserId();
    if (userId === localId) return call.isLocalSpeaking();
    const participant = Array.from(call.remoteParticipants().values()).find(
      (participant) => !participant.isAgent && participant.identity === userId
    );
    return !!participant && call.isParticipantSpeaking(participant);
  };
}
