import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type {
  AgentSessionLogResponse,
  AgentSessionQueueResponse,
  AgentSessionResponse,
  ControlRequest,
  ControlResponse,
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
   * Returns the accepted action's id — which the fold stamps as `requestId`
   * on the folded message the action derives — plus whether the action went
   * out (`sent`) or waits in the session's queue (`queued`).
   */
  control(sessionId: string, request: ControlRequest) {
    return fetchWithToken<ControlResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    );
  },

  /** The actions waiting to dispatch in this session, oldest first. */
  queue(sessionId: string) {
    return fetchWithToken<AgentSessionQueueResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/queue`,
      { method: 'GET' }
    );
  },

  /**
   * Replace a queued prompt's text before it dispatches. Answers 404
   * (`NOT_FOUND`) once the action has dispatched, 422 if the queued action
   * is not a prompt.
   */
  editQueued(sessionId: string, actionId: string, prompt: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/queue/${actionId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      }
    ).then((result) => result.map(() => undefined));
  },

  /**
   * Remove a queued action before it dispatches. Answers 404 (`NOT_FOUND`)
   * once the action has dispatched — there is no un-sending.
   */
  removeQueued(sessionId: string, actionId: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/queue/${actionId}`,
      { method: 'DELETE' }
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
