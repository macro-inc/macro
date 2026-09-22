import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { agentVoiceClient } from '@service-agent-harness/voice';
import { type VoiceDependencies, VoiceStartError } from '../core/types';

export const voiceSource: Pick<VoiceDependencies, 'options' | 'start' | 'end'> =
  {
    options: (sessionId) =>
      throwOnErr(() => agentVoiceClient.options(sessionId)),
    start: async (sessionId, voice, clientSessionId) => {
      try {
        return await throwOnErr(() =>
          agentVoiceClient.start(sessionId, voice, clientSessionId)
        );
      } catch (error) {
        throw new VoiceStartError(
          error instanceof Error ? error.message : 'Voice could not connect.',
          !thrownResultErrorHasCode(error, 'VOICE_REJECTED') &&
            !thrownResultErrorHasCode(error, 'UNAUTHORIZED')
        );
      }
    },
    end: (sessionId, voiceSessionId) =>
      throwOnErr(() => agentVoiceClient.end(sessionId, voiceSessionId)),
  };
