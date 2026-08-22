import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { authServiceClient } from '@service-auth/client';

import {
  MCP_SESSION_STORAGE_KEY,
  isSafeMcpClientRedirect,
  readMcpSessionId,
} from './mcpLoginSession';

export {
  MCP_SESSION_STORAGE_KEY,
  isSafeMcpClientRedirect,
  persistMcpSessionFromSearch,
  readMcpSessionId,
} from './mcpLoginSession';

export async function completeMcpLoginIfPresent(): Promise<boolean> {
  const sessionId = readMcpSessionId();
  if (!sessionId) return false;

  const tokens = await authServiceClient.readProductTokens();
  if (!tokens) {
    toast.failure('Could not finish connecting this MCP client. Try again.');
    return false;
  }

  let response: Response;
  try {
    response = await fetch(
      `${SERVER_HOSTS['mcp-service']}/login/${sessionId}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: tokens.refreshToken }),
      }
    );
  } catch {
    toast.failure('Could not finish connecting this MCP client. Try again.');
    return false;
  }

  if (!response.ok) {
    toast.failure('Could not finish connecting this MCP client. Try again.');
    return false;
  }

  const body: unknown = await response.json().catch(() => null);
  const redirect =
    typeof body === 'object' &&
    body !== null &&
    'redirect' in body &&
    typeof body.redirect === 'string'
      ? body.redirect
      : undefined;
  if (!redirect || !isSafeMcpClientRedirect(redirect)) {
    toast.failure('Could not finish connecting this MCP client. Try again.');
    return false;
  }

  sessionStorage.removeItem(MCP_SESSION_STORAGE_KEY);
  window.location.href = redirect;
  return true;
}
