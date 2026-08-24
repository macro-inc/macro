import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type {
  AgentSessionLogResponse,
  AgentSessionResponse,
  ControlRequest,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  SandboxSize,
  SandboxSizeBody,
} from './generated/schemas';

export type { SandboxSize, SandboxSizeBody };

const agentHarnessHost = SERVER_HOSTS['agent-harness'];

/** Authenticated client for controlling live agent sessions. */
export const agentHarnessServiceClient = {
  create(request: CreateAgentSessionRequest) {
    return fetchWithToken<CreateAgentSessionResponse>(
      `${agentHarnessHost}/agent-sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    );
  },

  get(sessionId: string) {
    return fetchWithToken<AgentSessionResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}`,
      { method: 'GET' }
    );
  },

  getLog(sessionId: string) {
    return fetchWithToken<AgentSessionLogResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/log`,
      { method: 'GET' }
    );
  },

  control(sessionId: string, request: ControlRequest) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    ).then((result) => result.map(() => undefined));
  },

  delete(sessionId: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}`,
      { method: 'DELETE' }
    ).then((result) => result.map(() => undefined));
  },

  getSandboxSize() {
    return fetchWithToken<SandboxSizeBody>(
      `${agentHarnessHost}/agent-sandbox-size`,
      {
        method: 'GET',
      }
    );
  },

  setSandboxSize(size: SandboxSize) {
    return fetchWithToken<SandboxSizeBody>(
      `${agentHarnessHost}/agent-sandbox-size`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size }),
      }
    );
  },

  setSessionSandboxSize(sessionId: string, size: SandboxSize) {
    return fetchWithToken<SandboxSizeBody>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/sandbox-size`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size }),
      }
    );
  },
};
