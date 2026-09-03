const AUTH_ATTEMPT_PREFIX = 'mcp:auth-attempted:';

export function mcpAuthAttemptKey(url: string): string {
  try {
    const parsed = new URL(url);
    return AUTH_ATTEMPT_PREFIX + parsed.origin + parsed.pathname;
  } catch {
    return AUTH_ATTEMPT_PREFIX + url;
  }
}

export function readMcpAuthAttempted(url: string): boolean {
  try {
    return localStorage.getItem(mcpAuthAttemptKey(url)) === '1';
  } catch {
    return false;
  }
}

export function writeMcpAuthAttempted(url: string, attempted: boolean): void {
  try {
    if (attempted) localStorage.setItem(mcpAuthAttemptKey(url), '1');
    else localStorage.removeItem(mcpAuthAttemptKey(url));
  } catch {
    return;
  }
}
