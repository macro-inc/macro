import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { Telemetry } from '@macro-inc/observability';

import { fetchWithAuth } from '@service-auth/fetch';
import { err, type Result } from 'neverthrow';
import { fetchToken } from '../auth/session-refresh';

export {
  confirmSessionExpired,
  ensureFreshSession,
  fetchToken,
  unsetTokenPromise,
} from '../auth/session-refresh';

import type { ObjectLike, ResultError } from './result';
import {
  type BaseFetchErrorCode,
  type ErrorResponseHandler,
  type SafeFetchInit,
  safeFetch,
} from './safeFetch';
import { redactLinkTokens, telemetryUrl } from './telemetryUrl';

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
  const requestInit = {
    ...init,
    trace: {
      ...init?.trace,
      parentSpan: init?.trace?.parentSpan ?? Telemetry.captureContext(),
    },
  };
  if (ENABLE_BEARER_TOKEN_AUTH) {
    const result = await fetchWithAuth<T, CustomErrorCode>(input, requestInit);
    if (result.isErr()) {
      Telemetry.error('fetchWithToken: fetchWithAuth failed', {
        input: telemetryUrl(input),
        method: init?.method,
        errors: redactLinkTokens(JSON.stringify(result.error)),
      });
    }

    return result;
  }

  let result = await fetchWithCredentials<T, CustomErrorCode>(
    input,
    requestInit
  );

  if (
    result.isErr() &&
    result.error.some((error) => error.code === 'UNAUTHORIZED')
  ) {
    const tokenResult = await requestInit.trace.parentSpan.run(() =>
      fetchToken(init?.signal)
    );
    if (tokenResult.isErr()) {
      // A definitive rejection already carries UNAUTHORIZED; transient refresh
      // failures surface as-is so callers don't treat an outage as a dead
      // session.
      return err(tokenResult.error);
    }

    // The caller may have given up while the session refreshed, for example
    // because the signed-in account changed; never replay under the new one.
    if (init?.signal?.aborted)
      return err([
        {
          name: 'AbortError',
          code: 'NETWORK_ERROR',
          message: 'Request aborted before retry',
        },
      ]);

    // Retry the original request
    result = await fetchWithCredentials<T, CustomErrorCode>(input, requestInit);
  }

  return result;
}
