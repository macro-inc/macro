import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { logger } from '@observability';
import { fetchWithAuth } from '@service-auth/fetch';
import {
  err,
  isErr,
  isOk,
  type MaybeError,
  type MaybeResult,
  type ObjectLike,
} from './maybeResult';
import {
  type BaseFetchErrorCode,
  type SafeFetchInit,
  safeFetch,
} from './safeFetch';

export type FetchWithTokenErrorCode = BaseFetchErrorCode | 'GRAPHQL_ERROR';

function fetchWithCredentials<T extends ObjectLike>(
  input: RequestInfo,
  init?: SafeFetchInit
): Promise<MaybeResult<BaseFetchErrorCode, T>> {
  return safeFetch<T>(input, {
    ...init,
    credentials: 'include',
  });
}

let tokenPromise: Promise<MaybeError<FetchWithTokenErrorCode>> | null = null;

export async function fetchToken(): Promise<
  MaybeError<FetchWithTokenErrorCode>
> {
  if (tokenPromise == null) {
    tokenPromise = (async () => {
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

      if (isErr(result)) {
        return [result[0]!];
        // return [null, result[0]];
      }

      return [null];
    })();
  }
  return tokenPromise;
}

/**
 * Performs a fetch request with automatic token refresh on unauthorized errors.
 *
 * @template T - The expected response data type.
 * @param {RequestInfo} input - The resource that you wish to fetch.
 * @param {SafeFetchInit} [init] - An options object containing any custom settings you want to apply to the request, including retry configuration.
 * @returns {Promise<MaybeResult<FetchWithTokenErrorCode, T>>} A promise that resolves to a MaybeResult containing either the response data or an error.
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
 * if (isErr(result)) {
 *   console.error('Error:', result[0]);
 * } else {
 *   console.log('User data:', result[1]);
 * }
 */
export async function fetchWithToken<T extends ObjectLike>(
  input: RequestInfo,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>> {
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const result = await fetchWithAuth<T>(input, init);
    if (isErr(result)) {
      logger.error('fetchWithToken: fetchWithAuth failed', {
        input,
        init,
        cause: {
          name: 'fetchWithAuthError',
          ...result[0],
        },
      });
    }

    return result;
  }

  let result = await fetchWithCredentials<T>(input, init);

  // GraphQL will throw unauthorized without the proper response code
  const graphql_unauthed =
    isOk(result) &&
    typeof input === 'string' &&
    input.endsWith('/graphql/') &&
    (result[1]?.errors?.[0]?.message?.startsWith('Not authorized') ||
      result[1]?.errors?.[0]?.message?.startsWith(
        'unable to validate access token'
      ));

  if (isErr(result, 'UNAUTHORIZED') || graphql_unauthed) {
    // Unset the token promise on UNAUTHORIZED error
    tokenPromise = null;

    const tokenResult = await fetchToken();
    if (isErr(tokenResult, 'HTTP_ERROR')) {
      // converting this most likely a bad request to unauthorized error
      return err('UNAUTHORIZED', '');
    }
    if (isErr(tokenResult)) {
      // Convert MaybeError to MaybeResult
      return [tokenResult[0], null];
    }

    // Retry the original request
    result = await fetchWithCredentials<T>(input, init);
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
  tokenPromise = null;
}
