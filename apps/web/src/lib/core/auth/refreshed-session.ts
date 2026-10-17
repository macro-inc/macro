import { fetchToken } from '@core/util/fetchWithToken';
import { sessionStatus, waitForSession } from './session';

/** The cookie refresh failed for a transient reason, such as an outage. */
export class SessionRefreshUnavailableError extends Error {
  constructor() {
    super('Unable to refresh the session cookie');
  }
}

/**
 * Waits for a signed-in session and refreshes its cookie, for transports that
 * cannot refresh on a 401 themselves (websocket handshakes). A rejected
 * refresh expires the session, so this waits for the next sign-in instead of
 * failing; a transient refresh failure throws for the caller's backoff.
 */
export async function refreshedSession(): Promise<void> {
  for (;;) {
    await waitForSession();
    const result = await fetchToken();
    if (result.isOk()) return;
    if (!result.error.some((error) => error.code === 'UNAUTHORIZED')) {
      throw new SessionRefreshUnavailableError();
    }
    // A rejection normally expires the session, so the next wait blocks. One
    // that raced a sign-in did not; hand it to the caller's backoff rather
    // than refreshing again straight away.
    if (sessionStatus() === 'signed-in') {
      throw new SessionRefreshUnavailableError();
    }
  }
}
