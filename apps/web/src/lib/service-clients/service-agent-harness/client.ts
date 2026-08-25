import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type {
  AgentActionId,
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

  rename(sessionId: string, name: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/name`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }
    ).then((result) => result.map(() => undefined));
  },

  /**
   * Returns the accepted action's id, which the fold stamps as `requestId`
   * on the folded message the action derives — the correlation handle for
   * watching that action's outcome.
   */
  control(sessionId: string, request: ControlRequest) {
    // The endpoint answers with a bare JSON string (`AgentActionId`), which
    // `fetchWithToken`'s object-or-bytes constraint cannot name; the cast is
    // the whole accommodation.
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    ).then((result) => result.map((id) => id as unknown as AgentActionId));
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
