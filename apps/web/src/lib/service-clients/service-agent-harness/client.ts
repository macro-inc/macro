import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ErrorResponseHandler } from '@core/util/safeFetch';
import {
  type AI_USAGE_LIMIT_ERROR,
  readAiUsageLimitError,
} from '../ai-usage-limit';
import type {
  AgentRepositoriesResponse,
  AgentRepositoryBranchesResponse,
  AgentSessionChangesPatchResponse,
  AgentSessionChangesResponse,
  AgentSessionLogResponse,
  AgentSessionQueueResponse,
  AgentSessionResponse,
  AnswerToolApprovalResponse,
  ControlRequest,
  ControlResponse,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  DiscoverAgentCapabilitiesRequest,
  DiscoverAgentCapabilitiesResponse,
  ExecutionRecord,
  LoadAgentModelsRequest,
  LoadAgentModelsResponse,
  PreviewAgentSessionsResponse,
  PullRequestSessionsResponse,
  PullRequestsSessionsResponse,
  SandboxSize,
  SandboxSizeBody,
  SessionPullRequestsResponse,
  SharePermissionV2,
  ToolApprovalAnswerDto,
  UpdateSharePermissionRequestV2,
  WarmAgentSessionResponse,
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

const sessionAiError: ErrorResponseHandler<
  typeof AI_USAGE_LIMIT_ERROR
> = async (response) =>
  (await readAiUsageLimitError(response)) ?? (await sessionError(response));

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

  discoverAgentCapabilities(
    request: DiscoverAgentCapabilitiesRequest,
    signal?: AbortSignal
  ) {
    return fetchWithToken<DiscoverAgentCapabilitiesResponse>(
      `${agentHarnessHost}/agent-capabilities/discover`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      }
    );
  },

  /** Prepare a hidden, unprompted in-memory session for this browser. */
  warm(id: string, signal?: AbortSignal) {
    return fetchWithToken<WarmAgentSessionResponse>(
      `${agentHarnessHost}/agent-sessions/warm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal,
      }
    );
  },

  create(request: CreateAgentSessionRequest) {
    return fetchWithToken<
      CreateAgentSessionResponse,
      typeof AI_USAGE_LIMIT_ERROR
    >(`${agentHarnessHost}/agent-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      errorResponseHandler: sessionAiError,
    });
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

  setArchived(sessionId: string, isArchived: boolean) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/archived`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived }),
        errorResponseHandler: sessionError,
      }
    ).then((result) => result.map(() => undefined));
  },

  /**
   * Returns the accepted action's id — which the fold stamps as `requestId`
   * on the folded message the action derives — plus whether the action went
   * out (`sent`) or waits in the session's queue (`queued`).
   */
  control(sessionId: string, request: ControlRequest) {
    return fetchWithToken<ControlResponse, typeof AI_USAGE_LIMIT_ERROR>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        errorResponseHandler: sessionAiError,
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

  /**
   * Run a queued action next. Moves it to the front and cancels the turn in
   * flight so it dispatches ahead of anything queued before it. Answers 404
   * (`NOT_FOUND`) once the action has dispatched.
   */
  steerQueued(sessionId: string, actionId: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/queue/${actionId}/steer`,
      { method: 'POST' }
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
  getCodeExecution(sessionId: string, executionId: string) {
    return fetchWithToken<ExecutionRecord>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/code-executions/${executionId}`,
      { method: 'GET', errorResponseHandler: sessionError }
    );
  },

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

  /** The pull requests linked to a session: its agent's and any a person linked. */
  listPullRequests(sessionId: string) {
    return fetchWithToken<SessionPullRequestsResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/pull-requests`,
      { method: 'GET' }
    );
  },

  /** Link the pull request at `url` to a session the caller can edit. */
  linkPullRequest(sessionId: string, url: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/pull-requests`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        errorResponseHandler: sessionError,
      }
    ).then((result) => result.map(() => undefined));
  },

  /** Unlink a pull request a person linked; the agent's own stays linked. */
  unlinkPullRequest(sessionId: string, url: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/pull-requests?${new URLSearchParams({ url })}`,
      { method: 'DELETE', errorResponseHandler: sessionError }
    ).then((result) => result.map(() => undefined));
  },

  /**
   * The sessions linked to each pull request in `urls` (at most 100) that the
   * caller can view, with the thread each session was started from.
   */
  sessionsForPullRequests(urls: string[]) {
    return fetchWithToken<PullRequestsSessionsResponse>(
      `${agentHarnessHost}/agent-sessions/by-pull-requests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      }
    );
  },

  /** The sessions linked to the pull request at `url` that the caller can view. */
  sessionsForPullRequest(url: string) {
    return fetchWithToken<PullRequestSessionsResponse>(
      `${agentHarnessHost}/agent-sessions/by-pull-request`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }
    );
  },

  /**
   * Answer a tool call the agent made in a turn somebody other than the
   * owner prompted. Approve and deny are the owner's; cancel is anyone's
   * with edit access. 409 once somebody already answered.
   */
  answerToolApproval(
    sessionId: string,
    approvalId: string,
    answer: ToolApprovalAnswerDto
  ) {
    return fetchWithToken<AnswerToolApprovalResponse>(
      `${agentHarnessHost}/agent-sessions/${sessionId}/tool-approvals/${approvalId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
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
