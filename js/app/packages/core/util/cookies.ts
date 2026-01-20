/**
 * Check if the user appears to be authenticated based on the login cookie.
 * This prevents making auth requests during unauthenticated flows (like signup).
 */
export function hasLoginCookie(): boolean {
  if (typeof document === 'undefined') return false;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'login' && value === 'true') {
      return true;
    }
  }
  return false;
}
