import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ErrorResponseHandler } from '@core/util/safeFetch';
import type {
  AgentRepositoriesResponse,
  AgentRepositoryBranchesResponse,
  AgentSessionChangesPatchResponse,
  AgentSessionChangesResponse,
  AgentSessionLogResponse,
  AgentSessionQueueResponse,
  AgentSessionResponse,
  ControlRequest,
  ControlResponse,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  LoadAgentModelsRequest,
  LoadAgentModelsResponse,
  PreviewAgentSessionsResponse,
  SandboxSize,
  SandboxSizeBody,
  SharePermissionV2,
  UpdateSharePermissionRequestV2,
} from './generated/schemas';

export type { SandboxSize, SandboxSizeBody };

const agentHarnessHost = SERVER_HOSTS['agent-harness'];

/** Session endpoints return safe, user-facing errors as plain text. */
const sessionError: ErrorResponseHandler<never> = async (response) => {
  const message = response.headers.get('content-type')?.startsWith('text/plain')
    ? (await response.text()).trim()
    : '';
  return {
    code: response.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR',
    message:
      message === 'repository is not available to this user'
        ? 'Connect GitHub to Macro with access to the selected repository, or choose a repository your Macro account can access.'
        : message || `Agent request failed (HTTP ${response.status}).`,
  };
};

/** Authenticated client for controlling live agent sessions. */
export const agentHarnessServiceClient = {
  preview(sessionIds: string[]) {
    return fetchWithToken<PreviewAgentSessionsResponse>(
      `${agentHarnessHost}/agent-sessions/preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds }),
      }
    );
  },
  /** Probes one agent target for its current, uncached model catalog. */
  loadAgentModels(request: LoadAgentModelsRequest, signal?: AbortSignal) {
    return fetchWithToken<LoadAgentModelsResponse>(
      `${agentHarnessHost}/agent-models/load`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      }
    );
  },

  create(request: CreateAgentSessionRequest) {
    return fetchWithToken<CreateAgentSessionResponse>(
      `${agentHarnessHost}/agent-sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        errorResponseHandler: sessionError,
      }
    );
  },

  /**
   * The GitHub repositories the caller can select for a coding session, with
   * the branch each one's sessions start on by default.
   */
  listRepositories() {
    return fetchWithToken<AgentRepositoriesResponse>(
      `${agentHarnessHost}/agent-repositories`,
      { method: 'GET' }
    );
  },

  /**
   * The branches on one GitHub repository the caller can start a coding
   * session from. `repoUrl` is the canonical `https://github.com/owner/name`
   * form `listRepositories` and create-session share.
   */
  listRepositoryBranches(repoUrl: string) {
    const params = new URLSearchParams({ repoUrl });
    return fetchWithToken<AgentRepositoryBranchesResponse>(
      `${agentHarnessHost}/agent-repositories/branches?${params}`,
      { method: 'GET' }
    );
  },

  get(sessionId: string) {
    return fetchWithToken<AgentSessionResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}`,
      { method: 'GET' }
    );
  },

  getPermissions(sessionId: string) {
    return fetchWithToken<SharePermissionV2>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/permissions`,
      { method: 'GET' }
    );
  },

  updatePermissions(
    sessionId: string,
    request: UpdateSharePermissionRequestV2
  ) {
    return fetchWithToken<SharePermissionV2>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/permissions`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        errorResponseHandler: sessionError,
      }
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
        errorResponseHandler: sessionError,
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

  /**
   * The session's latest captured changes: changed files with statuses and
   * line counts, plus how the latest capture attempt went.
   */
  getChanges(sessionId: string) {
    return fetchWithToken<AgentSessionChangesResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/changes`,
      { method: 'GET' }
    );
  },

  /** The unified diff behind the session's latest changeset. 404 until one exists. */
  getChangesPatch(sessionId: string) {
    return fetchWithToken<AgentSessionChangesPatchResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/changes/patch`,
      { method: 'GET' }
    );
  },

  /**
   * Capture the session's changes again now. Answers at once with the state
   * as it stands; the capture lands through the `agent_session_changes`
   * realtime event.
   */
  refreshChanges(sessionId: string) {
    return fetchWithToken<AgentSessionChangesResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/changes/refresh`,
      { method: 'POST' }
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
