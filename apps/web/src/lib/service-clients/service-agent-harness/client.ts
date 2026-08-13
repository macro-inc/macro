import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ControlRequest } from './generated/schemas';

const agentHarnessHost = SERVER_HOSTS['agent-harness'];

/** Authenticated client for controlling live agent sessions. */
export const agentHarnessServiceClient = {
  control(sessionId: string, request: ControlRequest) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${encodeURIComponent(sessionId)}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    ).then((result) => result.map(() => undefined));
  },
};
