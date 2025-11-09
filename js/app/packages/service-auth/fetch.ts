import { LOCAL_ONLY } from '@core/constant/featureFlags';
import {
  err,
  type HybridResultError,
  type ObjectLike,
  ok,
  type ResultError,
  toHybridError,
} from '@core/util/maybeResult';
import {
  type BaseFetchErrorCode,
  type ErrorResponseHandler,
  type SafeFetchInit,
  safeFetch,
  type TextResponse,
} from '@core/util/safeFetch';
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

  if (!macroApiTokenPromise) {
    macroApiTokenPromise = new Promise((resolve, reject) =>
      authServiceClient.macroApiToken().then(([err, result]) => {
        if (err) {
          reject(err);
        } else if (result) {
          resolve(result.macro_api_token);
        } else {
          reject(new Error('No result from macroApiToken'));
        }
      })
    );
  }
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
type HybridMaybeResult<ErrorCode extends string, T> =
  | [null, T]
  | [HybridResultError<ErrorCode>, null];

export async function fetchWithAuth<
  T extends ObjectLike | TextContentType = {},
  CustomErrorCode extends string = never,
>(
  input: RequestInfo,
  init?: fetchWithAuthOptions<T, CustomErrorCode>
): Promise<HybridMaybeResult<BaseFetchErrorCode | CustomErrorCode, T>> {
  const apiToken = await getMacroApiToken();
  if (!apiToken) {
    const [noTokenError] = err(
      'UNAUTHORIZED',
      'No access and/or refresh token found'
    );
    return [toHybridError(noTokenError), null];
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
  const [errors, result] = await safeFetch<SafeFetchT<T>, CustomErrorCode>(
    input,
    safeFetchInit,
    safeFetchErrorHandler
  );

  // TODO: Refactor when backward compatibility is no longer needed
  if (!!errors && errors.length > 0) {
    return [toHybridError(errors), null];
  }

  return ok(result as T);
}
