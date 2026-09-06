import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ErrorResponseHandler } from '@core/util/safeFetch';
import type {
  Agent,
  AgentSessionLogResponse,
  AgentSessionQueueResponse,
  AgentSessionResponse,
  ApprovePairingRequest,
  ControlRequest,
  ControlResponse,
  CreateAgentRequest,
  CreateAgentSessionRequest,
  CreateAgentSessionResponse,
  CursorApiKeyStatus,
  CursorModelsResponse,
  Harness,
  PairingDetails,
  SandboxSize,
  SandboxSizeBody,
  UpdateAgentRequest,
} from './generated/schemas';

export type {
  Agent,
  CursorApiKeyStatus,
  CursorModelsResponse,
  Harness,
  PairingDetails,
  SandboxSize,
  SandboxSizeBody,
};

const agentHarnessHost = SERVER_HOSTS['agent-harness'];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Surfaces the Cursor connection endpoints' own error message instead of a
 * generic one derived from the status code.
 *
 * These endpoints answer with a body that already says what went wrong and is
 * written to be safe to show a user — "value does not look like a Cursor API
 * key", "Cursor's API is unavailable right now". The default handler throws
 * that away and reports `HTTP error! status: 502`, which tells the user
 * nothing they can act on.
 */
const cursorApiKeyErrorResponseHandler: ErrorResponseHandler<'CURSOR_API_KEY_ERROR'> =
  async function handleCursorApiKeyErrorResponse(response) {
    // Falls back to the status when the body is not the shape we expect: a
    // failure to parse an error must not replace the error.
    const message = await response
      .json()
      .then((body: unknown) =>
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : undefined
      )
      .catch(() => undefined);

    return {
      code: 'CURSOR_API_KEY_ERROR',
      message: message ?? `HTTP error! status: ${response.status}`,
    };
  };

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

  // Agents (personas): the identities sessions run as.

  getAgents() {
    return fetchWithToken<Agent[]>(`${agentHarnessHost}/agents`, {
      method: 'GET',
    });
  },

  createAgent(request: CreateAgentRequest) {
    return fetchWithToken<Agent>(`${agentHarnessHost}/agents`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
  },

  updateAgent(agentId: string, request: UpdateAgentRequest) {
    return fetchWithToken<Agent>(`${agentHarnessHost}/agents/${agentId}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(request),
    });
  },

  // Registered macrod harnesses and device-code pairing.

  getHarnesses() {
    return fetchWithToken<Harness[]>(`${agentHarnessHost}/harnesses`, {
      method: 'GET',
    });
  },

  getHarnessPairing(code: string) {
    return fetchWithToken<PairingDetails>(
      `${agentHarnessHost}/harness-pairings/${encodeURIComponent(code)}`,
      { method: 'GET' }
    );
  },

  approveHarnessPairing(code: string, request: ApprovePairingRequest) {
    return fetchWithToken<Harness>(
      `${agentHarnessHost}/harness-pairings/${encodeURIComponent(code)}/approve`,
      {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(request),
      }
    );
  },

  deleteHarness(harnessId: string) {
    return fetchWithToken<Record<string, never>>(
      `${agentHarnessHost}/harnesses/${harnessId}`,
      { method: 'DELETE' }
    ).then((result) => result.map(() => undefined));
  },

  // The signed-in user's Cursor connection.

  /**
   * Whether the signed-in user has a Cursor API key stored.
   *
   * Never returns the key or any part of it — not even masked. There is no
   * screen that needs it, and a masked key still leaks its length.
   */
  getCursorApiKeyStatus() {
    return fetchWithToken<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
      `${agentHarnessHost}/cursor-api-key`,
      {
        method: 'GET',
        errorResponseHandler: cursorApiKeyErrorResponseHandler,
      }
    );
  },

  /**
   * Stores a Cursor API key for the signed-in user, replacing any existing
   * one, and makes sure they have their private `@cursor` agent. The key is
   * checked against Cursor before it is stored, so a key Cursor rejects fails
   * here with Cursor's answer rather than at the first session.
   */
  putCursorApiKey(apiKey: string) {
    return fetchWithToken<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
      `${agentHarnessHost}/cursor-api-key`,
      {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ apiKey }),
        errorResponseHandler: cursorApiKeyErrorResponseHandler,
      }
    );
  },

  /**
   * Forgets the signed-in user's Cursor API key.
   *
   * Does not revoke it at Cursor — the key keeps working everywhere else, and
   * only Cursor can revoke it. The UI has to say so. The user's Cursor agent
   * stays; it is simply not mentionable until a key is stored again.
   */
  deleteCursorApiKey() {
    return fetchWithToken<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
      `${agentHarnessHost}/cursor-api-key`,
      {
        method: 'DELETE',
        errorResponseHandler: cursorApiKeyErrorResponseHandler,
      }
    );
  },

  /**
   * The models the signed-in user's Cursor account offers. Asks Cursor live
   * through the stored key, so it needs a connected account — a caller with
   * none gets the endpoint's own `409` message.
   */
  listCursorModels() {
    return fetchWithToken<CursorModelsResponse, 'CURSOR_API_KEY_ERROR'>(
      `${agentHarnessHost}/cursor-api-key/models`,
      {
        method: 'GET',
        errorResponseHandler: cursorApiKeyErrorResponseHandler,
      }
    );
  },

  /** Chooses the model a newly created Cursor agent is seeded with. */
  putCursorDefaultModel(modelId: string) {
    return fetchWithToken<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
      `${agentHarnessHost}/cursor-api-key/default-model`,
      {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ modelId }),
        errorResponseHandler: cursorApiKeyErrorResponseHandler,
      }
    );
  },
};
