import { perfMark } from '@app/observability/perf-marks';
import { SERVER_HOSTS } from '@core/constant/servers';
import { err, ok, type Result } from 'neverthrow';
import type { ResultError } from '../util/result';
import {
  type BaseFetchErrorCode,
  type ErrorResponseHandler,
  safeFetch,
} from '../util/safeFetch';

type TokenResult = Result<void, ResultError<BaseFetchErrorCode>[]>;

let tokenPromise: Promise<TokenResult> | null = null;
let refreshedAt: number | undefined;
// Proactive socket setup can reuse a just-refreshed cookie. A server 401 must
// always force a new refresh, regardless of this short reuse window.
const RECENT_SESSION_REFRESH_MS = 30_000;

// Once /jwt/refresh definitively rejects the session, cache that failure so
// subsequent 401s short-circuit instead of each firing another doomed refresh.
// An anonymous visitor on a public link otherwise triggers one refresh per
// authenticated app-chrome query. Only a definitive rejection latches:
// transient failures (proxy errors, outages) must never be remembered as
// "logged out". Cleared by unsetTokenPromise on login, by TTL expiry, and when
// the app regains visibility/connectivity — on native the webview lives for
// days without a reload, so a permanent latch turns one bad response into a
// forced re-login.
let refreshUnavailable: TokenResult | null = null;
let refreshUnavailableAt = 0;
const REFRESH_UNAVAILABLE_TTL_MS = 60_000;

// Bumped on every reset. A refresh started before a reset carries the older
// generation, so once the session has moved on (e.g. a login) it can neither
// re-latch refreshUnavailable nor clear a newer tokenPromise on completion.
let refreshGeneration = 0;

function clearRefreshLatch() {
  refreshUnavailable = null;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('online', clearRefreshLatch);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clearRefreshLatch();
  });
}

// The auth service's definitive "this session cannot be refreshed" bodies
// (RefreshError and the token-extraction middleware in authentication_service
// return these as text/plain 400s). Any other non-2xx on /jwt/refresh — proxy
// 400s, 408/429, 5xx — is transient and must not latch.
const REFRESH_REJECTED_BODIES = new Set([
  'invalid refresh token',
  'no access token to refresh',
  'no refresh token to refresh',
]);

const classifyRefreshError: ErrorResponseHandler<never> = async (response) => {
  if (response.status === 401) {
    return { code: 'UNAUTHORIZED', message: 'Unauthorized access' };
  }
  if (response.status === 400) {
    let body = '';
    try {
      body = (await response.text()).trim();
    } catch {}
    if (REFRESH_REJECTED_BODIES.has(body)) {
      return { code: 'UNAUTHORIZED', message: body };
    }
  }
  return {
    code: 'HTTP_ERROR',
    message: `HTTP error! status: ${response.status}`,
  };
};

/**
 * Proactive session setup shares a recent successful refresh. Authentication
 * failures must call fetchToken directly so a 401 always reaches the server.
 */
export async function ensureFreshSession(): Promise<TokenResult> {
  if (tokenPromise) return tokenPromise;
  const age = refreshedAt === undefined ? undefined : Date.now() - refreshedAt;
  if (age !== undefined && age >= 0 && age < RECENT_SESSION_REFRESH_MS) {
    return ok(undefined);
  }
  return fetchToken();
}

/** Force a refresh after a server rejects the current credentials. */
export async function fetchToken(): Promise<TokenResult> {
  if (refreshUnavailable != null) {
    if (Date.now() - refreshUnavailableAt < REFRESH_UNAVAILABLE_TTL_MS) {
      return refreshUnavailable;
    }
    refreshUnavailable = null;
  }
  if (tokenPromise == null) {
    const generation = refreshGeneration;
    refreshedAt = undefined;
    tokenPromise = (async () => {
      perfMark('auth.refresh-start', { generation });
      try {
        const result = await safeFetch(
          `${SERVER_HOSTS['auth-service']}/jwt/refresh`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            cache: 'no-store',
            credentials: 'include',
          },
          classifyRefreshError
        );

        perfMark('auth.refresh-end', { generation, ok: result.isOk() });
        if (result.isErr()) {
          const failure = err(result.error);
          if (
            generation === refreshGeneration &&
            result.error.some((e) => e.code === 'UNAUTHORIZED')
          ) {
            refreshUnavailable = failure;
            refreshUnavailableAt = Date.now();
          }
          return failure;
        }

        if (generation === refreshGeneration) refreshedAt = Date.now();
        return ok(undefined);
      } finally {
        if (generation === refreshGeneration) {
          tokenPromise = null;
        }
      }
    })();
  }
  return tokenPromise;
}

/**
 * Bypasses any latched refresh failure and asks the auth service directly
 * whether the session can still be refreshed. Returns true only on a
 * definitive rejection. Callers about to destroy local session state must use
 * this instead of trusting a possibly-stale latched UNAUTHORIZED.
 */
export async function confirmSessionExpired(): Promise<boolean> {
  refreshUnavailable = null;
  const result = await fetchToken();
  return result.isErr() && result.error.some((e) => e.code === 'UNAUTHORIZED');
}

/**
 * Unsets the token promise, forcing a new token to be fetched on the next request.
 * This can be useful in situations where you know the token has become invalid.
 *
 * @example
 * import { unsetTokenPromise } from './path-to-this-module';
 *
 * // After logging out the user
 * unsetTokenPromise();
 */
export function unsetTokenPromise() {
  refreshedAt = undefined;
  refreshGeneration++;
  tokenPromise = null;
  refreshUnavailable = null;
}
