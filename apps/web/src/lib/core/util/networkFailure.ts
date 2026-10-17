// What each engine rejects fetch with when no response arrived: Chromium,
// WebKit (Safari and the iOS webview), Firefox.
const BROWSER_NETWORK_FAILURES = new Set([
  'Failed to fetch',
  'Load failed',
  'NetworkError when attempting to fetch resource.',
]);

/**
 * Whether a fetch rejection means the request never got a response. The native
 * HTTP plugin rejects with reqwest's error text as a string (`error sending
 * request for url (…)`), not a TypeError. Aborts and configuration errors such
 * as an invalid URL are not network failures.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return BROWSER_NETWORK_FAILURES.has(error.message);
  }
  const message = error instanceof Error ? error.message : error;
  return (
    typeof message === 'string' && message.startsWith('error sending request')
  );
}
