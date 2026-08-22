export const MCP_SESSION_STORAGE_KEY = 'mcp_session';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function persistMcpSessionFromSearch(search: string): string | undefined {
  const sessionId = new URLSearchParams(search).get('mcp_session');
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    return sessionStorage.getItem(MCP_SESSION_STORAGE_KEY) ?? undefined;
  }
  sessionStorage.setItem(MCP_SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

export function readMcpSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return persistMcpSessionFromSearch(window.location.search);
}

export function isSafeMcpClientRedirect(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}
