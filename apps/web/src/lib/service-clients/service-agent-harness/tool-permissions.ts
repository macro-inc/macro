import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import { type ErrorResponseHandler, statusError } from '@core/util/safeFetch';
import type { TraceContext } from '@macro-inc/observability';
import type {
  AgentToolPermissions,
  ToolPermissionCatalog,
  ToolPermissionChanges,
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

function agentPath(agentId: string) {
  return `${host}/agents/${encodeURIComponent(agentId)}/tool-permissions`;
}

/**
 * An agent's tool permissions (agent harness, `agent-tool-permissions`).
 *
 * TODO(agent-permissions references): the source routes and the view's
 * `source`/`inherited` fields aren't in the generated client yet, so these
 * methods take the response type from the caller
 * (`features/agent-permissions/queries/references-view.ts`). Drop the type
 * parameters for the generated types once the OpenAPI has them.
 */
export const toolPermissionsClient = {
  /** Every group, its tools and the five actions, in display order. */
  catalog() {
    return fetchWithToken<ToolPermissionCatalog>(
      `${host}/agent-tool-permissions/catalog`,
      { trace: FEATURE_OFF_IS_EXPECTED }
    );
  },

  /** The agent's saved rules and every group action's resolved state. */
  get<View extends ObjectLike = AgentToolPermissions>(agentId: string) {
    return fetchWithToken<View, typeof TOOL_PERMISSION_REFUSED>(
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
  setSource<View extends ObjectLike>(
    agentId: string,
    body: { sourcePolicyId: string },
    parentSpan?: TraceContext
  ) {
    return fetchWithToken<View, typeof TOOL_PERMISSION_REFUSED>(
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
  detach<View extends ObjectLike>(
    agentId: string,
    body: { changes?: ToolPermissionChanges['changes'] },
    parentSpan?: TraceContext
  ) {
    return fetchWithToken<View, typeof TOOL_PERMISSION_REFUSED>(
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
  sources<List extends ObjectLike>(query: {
    agentId?: string;
    scope?: 'private' | 'team';
    teamId?: string;
  }) {
    const params = new URLSearchParams();
    if (query.agentId) params.set('agentId', query.agentId);
    if (query.scope) params.set('scope', query.scope);
    if (query.teamId) params.set('teamId', query.teamId);
    return fetchWithToken<List, typeof TOOL_PERMISSION_REFUSED>(
      `${host}/agent-tool-permissions/sources?${params}`,
      {
        errorResponseHandler: toolPermissionError,
        trace: FEATURE_OFF_IS_EXPECTED,
      }
    );
  },

  /** A policy's resolved permissions, read-only (a source's preview). */
  policy<View extends ObjectLike>(policyId: string) {
    return fetchWithToken<View, typeof TOOL_PERMISSION_REFUSED>(
      `${host}/agent-tool-permissions/policies/${encodeURIComponent(policyId)}`,
      {
        errorResponseHandler: toolPermissionError,
        trace: FEATURE_OFF_IS_EXPECTED,
      }
    );
  },
};
