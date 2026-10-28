const AUTH_ATTEMPT_PREFIX = 'mcp:auth-attempted:';

export function mcpAuthAttemptKey(url: string): string {
  try {
    const parsed = new URL(url);
    return AUTH_ATTEMPT_PREFIX + parsed.origin + parsed.pathname;
  } catch {
    return AUTH_ATTEMPT_PREFIX + url;
  }
}

export function clearMcpAuthAttempts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(AUTH_ATTEMPT_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    return;
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
