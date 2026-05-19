import { LOCAL_ONLY } from '@core/constant/featureFlags';
import type { ObjectLike, ResultError } from '@core/util/result';
import {
  type BaseFetchErrorCode,
  type ErrorResponseHandler,
  type SafeFetchInit,
  safeFetch,
  type TextResponse,
} from '@core/util/safeFetch';
import { err, ok, type Result } from 'neverthrow';
import { authServiceClient } from './client';

function isExpired(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp * 1000;
    return Date.now() / 1000 > exp;
  } catch {
    return true;
  }
}

let macroApiTokenPromise: Promise<string> | null = null;
export async function getMacroApiToken() {
  if (LOCAL_ONLY) {
    const apiToken = import.meta.env.__LOCAL_JWT__;
    if (apiToken) {
      return apiToken;
    }
  }
  const apiToken = await macroApiTokenPromise;
  if (apiToken && !isExpired(apiToken)) {
    return apiToken;
  }

  macroApiTokenPromise = new Promise((resolve, reject) =>
    authServiceClient.macroApiToken().then((result) => {
      if (result.isErr()) {
        reject(result.error);
      } else {
        resolve(result.value.macro_api_token);
      }
    })
  );
  return macroApiTokenPromise;
}

type TextContentType = `text/${string}`;
type AcceptHeader<T extends ObjectLike | TextContentType> =
  | HeadersInit
  | (T extends TextContentType
      ? {
          Accept: T;
        }
      : {
          Accept: 'application/json';
        });
type SafeFetchT<T extends ObjectLike | TextContentType> =
  T extends TextContentType ? TextResponse : ObjectLike;
type fetchWithAuthOptions<
  T extends ObjectLike | TextContentType,
  CustomErrorCode extends string,
> = SafeFetchInit & {
  errorResponseHandler?: (
    response: Response
  ) => Promise<ResultError<BaseFetchErrorCode | CustomErrorCode>>;
  headers?: AcceptHeader<T>;
};
export async function fetchWithAuth<
  T extends ObjectLike | TextContentType = {},
  CustomErrorCode extends string = never,
>(
  input: RequestInfo,
  init?: fetchWithAuthOptions<T, CustomErrorCode>
): Promise<Result<T, ResultError<BaseFetchErrorCode | CustomErrorCode>[]>> {
  const apiToken = await getMacroApiToken();
  if (!apiToken) {
    return err([
      { code: 'UNAUTHORIZED', message: 'No access and/or refresh token found' },
    ]);
  }

  const safeFetchInit = {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${apiToken}`,
    },
  };

  const safeFetchErrorHandler: ErrorResponseHandler<CustomErrorCode> = async (
    response
  ) => {
    if (init?.errorResponseHandler) {
      return await init.errorResponseHandler(response);
    }

    switch (response.status) {
      case 404:
        return {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        };
      case 401:
        return {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized access',
        };
      case 409:
        return {
          code: 'CONFLICT',
          message: 'Resource conflict',
        };
      case 410:
        return {
          code: 'GONE',
          message: 'Resource deleted',
        };
      case 500:
        return {
          code: 'SERVER_ERROR',
          message: 'Internal server error',
        };
      default:
        return {
          code: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
        };
    }
  };

  // TODO: move safeFetch code to here
  const result = await safeFetch<SafeFetchT<T>, CustomErrorCode>(
    input,
    safeFetchInit,
    safeFetchErrorHandler
  );

  if (result.isErr()) {
    return err(result.error);
  }

  return ok(result.value as T);
}
