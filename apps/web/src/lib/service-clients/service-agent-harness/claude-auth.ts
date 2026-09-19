import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ErrorResponseHandler } from '@core/util/safeFetch';

// Mirrors the Rust /claude-auth DTOs. Neither response can contain provider credentials.
export type ClaudeAuthStatus = {
  enabled: boolean;
  connected: boolean;
  ephemeral: boolean;
};
export type ClaudeAuthStart = {
  attemptId: string;
  authorizationUrl: string;
  expiresIn: number;
};
const host = `${SERVER_HOSTS['agent-harness']}/claude-auth`;

const authError: ErrorResponseHandler<never> = async (response) => {
  const data: unknown = await response.json();
  return {
    code: response.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR',
    message:
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
        ? data.message
        : 'Claude connection request failed. Start Connect Claude again.',
  };
};
const writeOptions = {
  headers: { 'Content-Type': 'application/json' },
  cache: 'no-store' as const,
  errorResponseHandler: authError,
};

export const claudeAuthClient = {
  status(signal?: AbortSignal) {
    return fetchWithToken<ClaudeAuthStatus>(host, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
  },
  begin() {
    return fetchWithToken<ClaudeAuthStart>(`${host}/start`, {
      ...writeOptions,
      method: 'POST',
      body: '{}',
    });
  },
  complete(attemptId: string, code: string) {
    return fetchWithToken<Record<string, never>>(`${host}/complete`, {
      ...writeOptions,
      method: 'POST',
      body: JSON.stringify({ attemptId, code }),
    });
  },
  disconnect() {
    return fetchWithToken<Record<string, never>>(host, {
      ...writeOptions,
      method: 'DELETE',
      body: '{}',
    });
  },
};
