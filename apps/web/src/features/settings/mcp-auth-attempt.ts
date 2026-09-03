const AUTH_ATTEMPT_PREFIX = 'mcp:auth-attempted:';

export function readMcpAuthAttempted(url: string): boolean {
  try {
    return localStorage.getItem(AUTH_ATTEMPT_PREFIX + url) === '1';
  } catch {
    return false;
  }
}

export function writeMcpAuthAttempted(url: string, attempted: boolean): void {
  try {
    if (attempted) localStorage.setItem(AUTH_ATTEMPT_PREFIX + url, '1');
    else localStorage.removeItem(AUTH_ATTEMPT_PREFIX + url);
  } catch {
    return;
  }
}
