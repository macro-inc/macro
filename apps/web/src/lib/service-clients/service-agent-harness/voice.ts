import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ErrorResponseHandler } from '@core/util/safeFetch';

export type VoiceOptionsResponse = {
  enabled: boolean;
  voices: { id: string; label: string }[];
  maxDurationSeconds: number;
};
export type StartVoiceResponse = {
  voiceSessionId: string;
  roomName: string;
  url: string;
  token: string;
  participantIdentity: string;
  agentIdentity: string;
  expiresAt: string;
  voice: string;
};
type VoiceErrorCode = 'VOICE_REJECTED';
const voiceError: ErrorResponseHandler<VoiceErrorCode> = async (response) => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const message =
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string'
      ? payload.error
      : 'Voice could not connect. Please try again.';
  return {
    code: [400, 403, 409, 410].includes(response.status)
      ? 'VOICE_REJECTED'
      : 'HTTP_ERROR',
    message,
  };
};
const path = (sessionId: string) =>
  `${SERVER_HOSTS['agent-harness']}/agent-sessions/${encodeURIComponent(sessionId)}/voice`;

export const agentVoiceClient = {
  cancel(
    sessionId: string,
    request: {
      requestId: string;
      expectedActionId: string;
      replacement?: { actionId: string; prompt: string };
    }
  ) {
    return fetchWithToken<
      {
        status: 'stopping' | 'replaced';
        replacementActionId?: string;
      },
      VoiceErrorCode
    >(
      `${SERVER_HOSTS['agent-harness']}/agent-sessions/${encodeURIComponent(sessionId)}/turn/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        errorResponseHandler: voiceError,
      }
    );
  },
  options(sessionId: string) {
    return fetchWithToken<VoiceOptionsResponse, VoiceErrorCode>(
      `${path(sessionId)}/options`,
      {
        method: 'GET',
        errorResponseHandler: voiceError,
      }
    );
  },
  start(sessionId: string, voice: string, clientSessionId: string) {
    return fetchWithToken<StartVoiceResponse, VoiceErrorCode>(path(sessionId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice, clientSessionId }),
      errorResponseHandler: voiceError,
    });
  },
  async end(sessionId: string, voiceSessionId: string) {
    const result = await fetchWithToken<Record<string, never>, VoiceErrorCode>(
      `${path(sessionId)}/${encodeURIComponent(voiceSessionId)}`,
      { method: 'DELETE', errorResponseHandler: voiceError }
    );
    return result.map(() => undefined);
  },
};
