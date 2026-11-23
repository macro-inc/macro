import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { type ErrorResponseHandler, statusError } from '@core/util/safeFetch';
import type { TraceContext } from '@macro-inc/observability';
import type {
  AgentToolPermissions,
  DetachToolPermissions,
  GetAgentToolPermissionSourcesParams,
  SetToolPermissionSource,
  TeamToolPermissions,
  ToolPermissionCatalog,
  ToolPermissionChanges,
  ToolPermissionSourceCandidates,
} from './generated/schemas';

const host = SERVER_HOSTS['agent-harness'];

/**
 * A refusal the server explained (`needs_person`, `would_loosen`, …); its
 * message is written for the person and can be shown as is.
 */
export const TOOL_PERMISSION_REFUSED = 'TOOL_PERMISSION_REFUSED';

const toolPermissionError: ErrorResponseHandler<
  typeof TOOL_PERMISSION_REFUSED
> = async (response) => {
  const fallback = statusError(response.status);
  // 404 means the feature is off for this caller; keep its code.
  if (response.status === 404) return fallback;

  const body: unknown = await response.json().catch(() => undefined);
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return { code: TOOL_PERMISSION_REFUSED, message: body.message };
  }
  return fallback;
};

/** These routes answer 404 while the feature is off for the caller. */
const FEATURE_OFF_IS_EXPECTED = { expectedStatusCodes: [404] };

function teamPath(teamId: string) {
  return `${host}/agent-tool-permissions/teams/${encodeURIComponent(teamId)}`;
}

function agentPath(agentId: string) {
  return `${host}/agents/${encodeURIComponent(agentId)}/tool-permissions`;
}

/** An agent's tool permissions (agent harness, `agent-tool-permissions`). */
export const toolPermissionsClient = {
  /** Every group, its tools and the five actions, in display order. */
  catalog() {
    return fetchWithToken<ToolPermissionCatalog>(
      `${host}/agent-tool-permissions/catalog`,
      { trace: FEATURE_OFF_IS_EXPECTED }
    );
  },

  /** The agent's saved rules and every group action's resolved state. */
  get(agentId: string) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      agentPath(agentId),
      {
        errorResponseHandler: toolPermissionError,
        trace: FEATURE_OFF_IS_EXPECTED,
      }
    );
  },

  /**
   * The permissions that apply in an agent session: its agent's, with the
   * agent's limits on itself for this session.
   */
  session(sessionId: string) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      `${host}/agent-sessions/${encodeURIComponent(sessionId)}/tool-permissions`,
      {
        errorResponseHandler: toolPermissionError,
        trace: FEATURE_OFF_IS_EXPECTED,
      }
    );
  },

  /** Applies the changes in order and answers the new view. */
  set(
    agentId: string,
    changes: ToolPermissionChanges,
    parentSpan?: TraceContext
  ) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      agentPath(agentId),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
        errorResponseHandler: toolPermissionError,
        trace: { parentSpan },
      }
    );
  },

  /** Puts every saved setting back to Always allow. */
  reset(agentId: string, parentSpan?: TraceContext) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      agentPath(agentId),
      {
        method: 'DELETE',
        errorResponseHandler: toolPermissionError,
        trace: { parentSpan },
      }
    );
  },

  /** Makes the agent follow another policy (its source). */
  setSource(
    agentId: string,
    body: SetToolPermissionSource,
    parentSpan?: TraceContext
  ) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      `${agentPath(agentId)}/source`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        errorResponseHandler: toolPermissionError,
        trace: { parentSpan },
      }
    );
  },

  /**
   * Stops following: copies what the source resolves to into the agent's
   * own settings, then applies `changes`, in one transaction.
   */
  detach(
    agentId: string,
    body: DetachToolPermissions,
    parentSpan?: TraceContext
  ) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      `${agentPath(agentId)}/detach`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        errorResponseHandler: toolPermissionError,
        trace: { parentSpan },
      }
    );
  },

  /**
   * The policies an agent may follow: for an agent (`agentId`), or for a
   * new one by its scope.
   */
  sources(query: GetAgentToolPermissionSourcesParams) {
    const params = new URLSearchParams();
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.scope) params.set('scope', query.scope);
    if (query.teamId) params.set('teamId', query.teamId);
    return fetchWithToken<
      ToolPermissionSourceCandidates,
      typeof TOOL_PERMISSION_REFUSED
    >(`${host}/agent-tool-permissions/sources?${params}`, {
      errorResponseHandler: toolPermissionError,
      trace: FEATURE_OFF_IS_EXPECTED,
    });
  },

  /** A policy's resolved permissions, read-only (a source's preview). */
  policy(policyId: string) {
    return fetchWithToken<AgentToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      `${host}/agent-tool-permissions/policies/${encodeURIComponent(policyId)}`,
      {
        errorResponseHandler: toolPermissionError,
        trace: FEATURE_OFF_IS_EXPECTED,
      }
    );
  },

  /** A team's default permissions, which its new agents follow. */
  team(teamId: string) {
    return fetchWithToken<TeamToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      teamPath(teamId),
      {
        errorResponseHandler: toolPermissionError,
        trace: FEATURE_OFF_IS_EXPECTED,
      }
    );
  },

  /** Changes a team's default permissions (team admins and owners). */
  setTeam(
    teamId: string,
    changes: ToolPermissionChanges,
    parentSpan?: TraceContext
  ) {
    return fetchWithToken<TeamToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      teamPath(teamId),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
        errorResponseHandler: toolPermissionError,
        trace: { parentSpan },
      }
    );
  },

  /** Puts a team's default permissions back to Allow. */
  resetTeam(teamId: string, parentSpan?: TraceContext) {
    return fetchWithToken<TeamToolPermissions, typeof TOOL_PERMISSION_REFUSED>(
      teamPath(teamId),
      {
        method: 'DELETE',
        errorResponseHandler: toolPermissionError,
        trace: { parentSpan },
      }
    );
  },
};
