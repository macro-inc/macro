import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { Telemetry } from '@macro-inc/observability';

import { fetchWithAuth } from '@service-auth/fetch';
import { err, ok, type Result } from 'neverthrow';
import type { ObjectLike, ResultError } from './result';
import {
  type BaseFetchErrorCode,
  type ErrorResponseHandler,
  type SafeFetchInit,
  safeFetch,
} from './safeFetch';

export type FetchWithTokenErrorCode = BaseFetchErrorCode;

export type FetchWithTokenInit<CustomErrorCode extends string = never> =
  SafeFetchInit & {
    errorResponseHandler?: ErrorResponseHandler<CustomErrorCode>;
  };

function fetchWithCredentials<
  T extends ObjectLike | Uint8Array,
  CustomErrorCode extends string = never,
>(
  input: RequestInfo,
  init?: FetchWithTokenInit<CustomErrorCode>
): Promise<Result<T, ResultError<BaseFetchErrorCode | CustomErrorCode>[]>> {
  const { errorResponseHandler, ...fetchInit } = init ?? {};
  let safeFetchErrorHandler: ErrorResponseHandler<CustomErrorCode> | undefined;
  if (errorResponseHandler) {
    safeFetchErrorHandler = async function handleFetchWithCredentialsError(
      response
    ) {
      if (response.status === 401) {
        return { code: 'UNAUTHORIZED', message: 'Unauthorized access' };
      }

      return errorResponseHandler(response);
    };
  }

  return safeFetch<T, CustomErrorCode>(
    input,
    {
      ...fetchInit,
      credentials: 'include',
    },
    safeFetchErrorHandler
  );
}

type TokenResult = Result<void, ResultError<FetchWithTokenErrorCode>[]>;

let tokenPromise: Promise<TokenResult> | null = null;

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

export async function fetchToken(): Promise<TokenResult> {
  if (refreshUnavailable != null) {
    if (Date.now() - refreshUnavailableAt < REFRESH_UNAVAILABLE_TTL_MS) {
      return refreshUnavailable;
    }
    refreshUnavailable = null;
  }
  if (tokenPromise == null) {
    const generation = refreshGeneration;
    tokenPromise = (async () => {
      try {
        const result = await fetchWithCredentials(
          `${SERVER_HOSTS['auth-service']}/jwt/refresh`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            cache: 'no-store',
            errorResponseHandler: classifyRefreshError,
          }
        );

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
 * Performs a fetch request with automatic token refresh on unauthorized errors.
 *
 * @template T - The expected response data type.
 * @template CustomErrorCode - Additional error codes from a custom error response handler.
 * @param {RequestInfo} input - The resource that you wish to fetch.
 * @param {FetchWithTokenInit<CustomErrorCode>} [init] - An options object containing any custom settings you want to apply to the request, including retry configuration and custom error response handling.
 * @returns {Promise<Result<T, ResultError<BaseFetchErrorCode | CustomErrorCode>[]>>} A promise that resolves to a Result containing either the response data or an error.
 *
 * @example
 * const result = await fetchWithToken<UserData>(
 *   'https://localhost/users/123',
 *   {
 *     method: 'GET',
 *     retry: { maxTries: 3, delay: 'exponential' }
 *   }
 * );
 *
 * if ((result).isErr()) {
 *   console.error('Error:', result.error);
 * } else {
 *   console.log('User data:', result.value);
 * }
 */
export async function fetchWithToken<
  T extends ObjectLike | Uint8Array,
  CustomErrorCode extends string = never,
>(
  input: RequestInfo,
  init?: FetchWithTokenInit<CustomErrorCode>
): Promise<Result<T, ResultError<BaseFetchErrorCode | CustomErrorCode>[]>> {
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const result = await fetchWithAuth<T, CustomErrorCode>(input, init);
    if (result.isErr()) {
      Telemetry.error('fetchWithToken: fetchWithAuth failed', {
        input: typeof input === 'string' ? input : input.url,
        method: init?.method,
        errors: JSON.stringify(result.error),
      });
    }

    return result;
  }

  let result = await fetchWithCredentials<T, CustomErrorCode>(input, init);

  if (
    result.isErr() &&
    result.error.some((error) => error.code === 'UNAUTHORIZED')
  ) {
    const tokenResult = await fetchToken();
    if (tokenResult.isErr()) {
      // A definitive rejection already carries UNAUTHORIZED; transient refresh
      // failures surface as-is so callers don't treat an outage as a dead
      // session.
      return err(tokenResult.error);
    }

    // Retry the original request
    result = await fetchWithCredentials<T, CustomErrorCode>(input, init);
  }

  return result;
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
  refreshGeneration++;
  tokenPromise = null;
  refreshUnavailable = null;
}
