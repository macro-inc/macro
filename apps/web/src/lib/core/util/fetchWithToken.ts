import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { logger } from '@observability';
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

// Once /jwt/refresh fails because the session is not authenticated (400/401),
// cache that failure so subsequent 401s short-circuit instead of each firing
// another doomed refresh. An anonymous visitor on a public link otherwise
// triggers one refresh per authenticated app-chrome query. Cleared by
// unsetTokenPromise, which the login flows call on a session change.
let refreshUnavailable: TokenResult | null = null;

// Bumped on every reset. A refresh started before a reset carries the older
// generation, so once the session has moved on (e.g. a login) it can neither
// re-latch refreshUnavailable nor clear a newer tokenPromise on completion.
let refreshGeneration = 0;

export async function fetchToken(): Promise<TokenResult> {
  if (refreshUnavailable != null) {
    return refreshUnavailable;
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
          }
        );

        if (result.isErr()) {
          const failure = err(result.error);
          if (
            generation === refreshGeneration &&
            result.error.some(
              (e) => e.code === 'HTTP_ERROR' || e.code === 'UNAUTHORIZED'
            )
          ) {
            refreshUnavailable = failure;
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
      logger.error('fetchWithToken: fetchWithAuth failed', {
        input,
        init,
        errors: result.error,
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
    if (
      tokenResult.isErr() &&
      tokenResult.error.some((error) => error.code === 'HTTP_ERROR')
    ) {
      // converting this most likely a bad request to unauthorized error
      return err([{ code: 'UNAUTHORIZED', message: '' }]);
    }
    if (tokenResult.isErr()) {
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
