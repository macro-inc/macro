import { useCallContextOptional } from './CallContext';

export type SpeakingCall = { callId?: string; channelId?: string };

/** Only the joined room supplies live speech; call records do not. */
export function useCallSpeaking() {
  const call = useCallContextOptional();
  return (target: SpeakingCall) => {
    if (!call?.isInCall() || (!target.callId && !target.channelId))
      return false;
    if (target.callId && target.callId !== call.activeCallId()) return false;
    if (target.channelId && target.channelId !== call.activeChannelId())
      return false;

    return (
      call.isLocalSpeaking() ||
      Array.from(call.remoteParticipants().values()).some(
        (participant) =>
          !participant.isAgent && call.isParticipantSpeaking(participant)
      )
    );
  };
}
