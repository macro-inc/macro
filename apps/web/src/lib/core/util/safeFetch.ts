import { SERVER_HOSTS, SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import { Telemetry } from '@macro-inc/observability';
import { err, ok, type Result } from 'neverthrow';
import { platformFetch } from './platformFetch';
import type { ObjectLike, ResultError } from './result';
import { sleep } from './sleep';

const tracedOrigins: ReadonlySet<string> = (() => {
  const origins = new Set<string>();
  for (const host of [
    ...Object.values(SERVER_HOSTS),
    SYNC_SERVICE_HOSTS.worker,
  ]) {
    try {
      origins.add(new URL(host).origin);
    } catch {}
  }
  if (typeof window !== 'undefined') origins.add(window.location.origin);
  return origins;
})();

function isTracedOrigin(url: URL): boolean {
  return tracedOrigins.has(url.origin);
}

function requestUrl(input: RequestInfo): URL | undefined {
  const raw = typeof input === 'string' ? input : input.url;
  try {
    return new URL(
      raw,
      typeof window === 'undefined' ? undefined : window.location.origin
    );
  } catch {
    return undefined;
  }
}

const UUID_PATH_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_PATH_SEGMENT = /^(?:\d+|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/;

function traceRoute(url: URL, route?: string): string {
  const configuredRoute = route?.split(/[?#]/, 1)[0];
  const pathname = configuredRoute || url.pathname || '/';
  const segments = pathname.split('/');
  const normalized = pathname
    .split('/')
    .map((segment, index) => {
      if (
        UUID_PATH_SEGMENT.test(segment) ||
        OPAQUE_PATH_SEGMENT.test(segment)
      ) {
        return '{id}';
      }
      if (configuredRoute || index <= 1 || segment === '') return segment;
      return '{path}';
    })
    .join('/');
  if (!configuredRoute && segments.length > 2) {
    return normalized.replace(/(?:\/\{path\})+$/, '/{path}');
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function requestMethod(input: RequestInfo, init: RequestInit): string {
  return (
    init.method ??
    (typeof input === 'string' ? undefined : input.method) ??
    'GET'
  ).toUpperCase();
}

function requestBodySize(
  body: BodyInit | null | undefined
): number | undefined {
  if (typeof body === 'string')
    return new TextEncoder().encode(body).byteLength;
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString()).byteLength;
  }
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
}

function retryBodyStream(
  body: BodyInit | null | undefined,
  maxTries: number
):
  | {
      next(attempt: number): BodyInit;
      cancel(): Promise<void>;
    }
  | undefined {
  if (
    maxTries <= 1 ||
    typeof ReadableStream === 'undefined' ||
    !(body instanceof ReadableStream)
  ) {
    return undefined;
  }

  let remaining: ReadableStream | undefined = body;
  return {
    next(attempt) {
      if (!remaining) throw new Error('Request body stream already consumed');
      if (attempt === maxTries) {
        const current = remaining;
        remaining = undefined;
        return current;
      }
      const [current, next] = remaining.tee();
      remaining = next;
      return current;
    },
    async cancel() {
      await remaining?.cancel();
      remaining = undefined;
    },
  };
}

function declaredBodySize(response: Response): number | undefined {
  const value = response.headers?.get('content-length') ?? null;
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
}

function networkErrorKind(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (
    error instanceof TypeError &&
    /^Failed to fetch\.?$/i.test(error.message)
  ) {
    return 'chromium_failed_to_fetch';
  }
  if (error.name === 'NetworkError' || /NetworkError/i.test(error.message)) {
    return 'firefox_network_error';
  }
  if (error instanceof TypeError && /^Load failed\.?$/i.test(error.message)) {
    return 'safari_load_failed';
  }
  return undefined;
}

function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function attemptHeaders(
  input: RequestInfo,
  init: RequestInit,
  method: string,
  requestId: string,
  includeRequestId: boolean
): Record<string, string> {
  const headers = new Headers(
    init.headers ?? (typeof input === 'string' ? undefined : input.headers)
  );
  if (
    method !== 'GET' &&
    method !== 'HEAD' &&
    !(init.body instanceof FormData) &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json');
  }
  if (includeRequestId) headers.set('x-request-id', requestId);
  return Object.fromEntries(headers.entries());
}

function tracedFetch(
  input: RequestInfo,
  init: RequestInit,
  context: {
    attempt: number;
    maxTries: number;
    method: string;
    requestId: string;
    route: string;
    traceOptions?: SafeFetchTraceOptions;
  }
): Promise<Response> {
  const url = requestUrl(input);
  const { attempt, maxTries, method, requestId, route, traceOptions } = context;
  const tracedOrigin = url ? isTracedOrigin(url) : false;
  const headers = attemptHeaders(input, init, method, requestId, tracedOrigin);
  const attemptInput =
    typeof input !== 'string' && maxTries > 1 && init.body === undefined
      ? input.clone()
      : input;
  if (!url) return platformFetch(attemptInput, { ...init, headers });
  const span = Telemetry.clientSpan(`HTTP ${method} ${route}`);
  span.setAttr('http.request.method', method);
  span.setAttr('http.method', method);
  span.setAttr('http.route', route);
  span.setAttr('url.scheme', url.protocol.slice(0, -1));
  span.setAttr('server.address', url.hostname);
  if (url.port) span.setAttr('server.port', Number(url.port));
  span.setAttr('url.path', route);
  // Use the normalized route: query strings and path segments can carry tokens.
  const sanitizedUrl = `${url.origin}${route}`;
  span.setAttr('url.full', sanitizedUrl);
  span.setAttr('http.url', sanitizedUrl);
  span.setAttr('request.id', requestId);
  span.setAttr('http.request.resend_count', attempt - 1);
  span.setAttr('safe_fetch.retry.attempt', attempt);
  span.setAttr('safe_fetch.retry.max_tries', maxTries);
  span.setAttr('safe_fetch.response.visible', false);
  const bodySize = requestBodySize(init.body);
  if (bodySize !== undefined) span.setAttr('http.request.body.size', bodySize);
  return span.run(async () => {
    try {
      if (tracedOrigin) {
        span.injectTraceHeaders(headers);
      }
      const response = await platformFetch(attemptInput, { ...init, headers });
      span.setAttr('safe_fetch.response.visible', true);
      span.setAttr('http.response.status_code', response.status);
      span.setAttr('http.status_code', response.status);
      const responseSize = declaredBodySize(response);
      if (responseSize !== undefined) {
        span.setAttr('http.response.body.size', responseSize);
      }
      const contentType = response.headers?.get('content-type');
      if (contentType)
        span.setAttr('http.response.body.content_type', contentType);
      if (!response.ok) {
        const expected = traceOptions?.expectedStatusCodes?.includes(
          response.status
        );
        if (expected) {
          span.setAttr('http.expected_status', true);
          return response;
        }
        span.setAttr('error.type', String(response.status));
        const message = `HTTP ${response.status} for ${method} ${route}`;
        span.error({
          name: 'HttpError',
          message,
          stack: new Error(message).stack,
        });
      }
      return response;
    } catch (error) {
      const kind = networkErrorKind(error);
      if (kind) {
        span.setAttr('error.type', kind);
        span.setAttr('network.error.kind', kind);
      }
      span.error(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Base error codes for fetch operations.
 */
export type BaseFetchErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'SERVER_ERROR'
  | 'INVALID_JSON'
  | 'UNKNOWN_ERROR'
  | 'GONE';

/**
 * A function type for custom error response handling.
 *
 * @template CustomErrorCode - Additional custom error codes.
 *
 * @example
 * // Define custom error codes
 * type MyApiErrorCode = 'RATE_LIMITED' | 'INVALID_INPUT';
 *
 * // Create a custom error handler
 * const myErrorHandler: ErrorResponseHandler<MyApiErrorCode> = async (response) => {
 *   const data = await response.json();
 *   if (response.status === 429) {
 *     return {
 *       code: 'RATE_LIMITED',
 *       message: 'Too many requests, please try again later',
 *     };
 *   } else if (response.status === 400) {
 *     return {
 *       code: 'INVALID_INPUT',
 *       message: data.error || 'Invalid input provided',
 *     };
 *   }
 *   // Fall back to default error handling
 *   return {
 *     code: 'HTTP_ERROR',
 *     message: `HTTP error! status: ${response.status}`,
 *   };
 * };
 */
export type ErrorResponseHandler<CustomErrorCode extends string> = (
  response: Response
) => Promise<ResultError<BaseFetchErrorCode | CustomErrorCode>>;

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  maxTries?: number;
  /** number in seconds or expnential backoff */
  delay?: 'exponential' | number;
}

/** Trace-only classification for responses that are expected by the caller. */
export interface SafeFetchTraceOptions {
  /** Low-cardinality route template used in span names, for example `/users/{id}`. */
  route?: string;
  /** Non-OK responses that should not mark the HTTP span as failed. */
  expectedStatusCodes?: readonly number[];
}

/**
 * Extended RequestInit interface that includes retry configuration.
 */
export interface SafeFetchInit extends RequestInit {
  retry?: RetryConfig;
  trace?: SafeFetchTraceOptions;
}

export type TextResponse = { contentType: 'text/plain'; body: string };

/**
 * Performs a safe fetch operation with structured error handling and retry capability.
 *
 * @template T - The expected return type of the fetch operation.
 * @template CustomErrorCode - Additional custom error codes (optional).
 * @param {RequestInfo} input - The resource to fetch.
 * @param {SafeFetchInit} [init] - Custom settings to apply to the request, including retry configuration.
 * @param {ErrorResponseHandler<CustomErrorCode>} [errorResponseHandler] - Custom error response handler.
 * @returns {Promise<Result<T, ResultError<BaseFetchErrorCode | CustomErrorCode>[]>>} A promise that resolves to a Result.
 *
 * @example
 * // Basic usage
 * async function fetchUser(userId: string) {
 *   const result = await safeFetch<{ id: string, name: string }>(
 *     `https://localhost/users/${userId}`
 *   );
 *
 *   if ((result).isErr()) {
 *     console.error('Error fetching user:', result.error);
 *     return;
 *   }
 *
 *   const user = result.value;
 *   console.log('User data:', user);
 * }
 *
 * @example
 * // Usage with custom error handling
 * type MyApiErrorCode = 'RATE_LIMITED' | 'INVALID_INPUT';
 *
 * const myErrorHandler: ErrorResponseHandler<MyApiErrorCode> = async (response) => {
 *   // ... (implementation as shown in {@link ErrorResponseHandler} example)
 * };
 *
 * async function fetchUserWithCustomErrors(userId: string) {
 *   const result = await safeFetch<{ id: string, name: string }, MyApiErrorCode>(
 *     `https://localhost/users/${userId}`,
 *     undefined,
 *     myErrorHandler
 *   );
 *
 *   if ((result).isErr()) {
 *     const errors = result.error;
 *     switch (errors[0].code) {
 *       case 'RATE_LIMITED':
 *         console.error('Rate limit reached:', errors[0].message);
 *         // Implement retry logic or inform user
 *         break;
 *       case 'INVALID_INPUT':
 *         console.error('Invalid input:', errors[0].message);
 *         // Prompt user to correct input
 *         break;
 *       default:
 *         console.error('Error fetching user:', errors);
 *     }
 *     return;
 *   }
 *
 *   const user = result.value;
 *   console.log('User data:', user);
 * }
 *
 * @example
 * // Basic usage with retry
 * async function fetchUser(userId: string) {
 *   const result = await safeFetch<{ id: string, name: string }>(
 *     `https://localhost/users/${userId}`,
 *     {
 *       method: 'GET',
 *       retry: { maxTries: 3, delay: 'exponential' }
 *     }
 *   );
 *
 *   if ((result).isErr()) {
 *     console.error('Error fetching user:', result.error);
 *     return;
 *   }
 *
 *   const user = result.value;
 *   console.log('User data:', user);
 * }
 */
export async function safeFetch<
  T extends (ObjectLike & (TextResponse | {})) | Uint8Array,
  CustomErrorCode extends string = never,
>(
  input: RequestInfo,
  init?: SafeFetchInit,
  errorResponseHandler?: ErrorResponseHandler<CustomErrorCode>
): Promise<Result<T, ResultError<BaseFetchErrorCode | CustomErrorCode>[]>> {
  const { retry, trace, ...fetchInit } = init || {};
  const maxTries = retry?.maxTries ?? 1;
  const delay = retry?.delay ?? 0;
  const method = requestMethod(input, fetchInit);
  const url = requestUrl(input);
  const route = url ? traceRoute(url, trace?.route) : '/unknown';

  return Telemetry.span(`safeFetch ${method} ${route}`, async (parentSpan) => {
    parentSpan.setAttr('http.request.method', method);
    parentSpan.setAttr('http.method', method);
    parentSpan.setAttr('http.route', route);
    parentSpan.setAttr('safe_fetch.retry.max_tries', maxTries);
    const bodySize = requestBodySize(fetchInit.body);
    if (bodySize !== undefined) {
      parentSpan.setAttr('http.request.body.size', bodySize);
    }

    type ErrorCode = BaseFetchErrorCode | CustomErrorCode;
    const fetchErr = (errors: ResultError<ErrorCode>[]) =>
      err<T, ResultError<ErrorCode>[]>(errors);
    let lastError: Result<T, ResultError<ErrorCode>[]> | undefined;
    let lastResponseStatus: number | undefined;
    let attempts = 0;
    const retryBody = retryBodyStream(fetchInit.body, maxTries);
    const retryRequest =
      typeof input !== 'string' && maxTries > 1 && fetchInit.body === undefined
        ? input
        : undefined;

    const result = await (async () => {
      for (let attempt = 1; attempt <= maxTries; attempt++) {
        attempts = attempt;
        lastResponseStatus = undefined;
        try {
          const attemptInit = retryBody
            ? { ...fetchInit, body: retryBody.next(attempt) }
            : fetchInit;
          const response = await tracedFetch(input, attemptInit, {
            attempt,
            maxTries,
            method,
            requestId: newRequestId(),
            route,
            traceOptions: trace,
          });
          lastResponseStatus = response.status;

          if (!response.ok) {
            if (errorResponseHandler) {
              const customError = await errorResponseHandler(response);
              return fetchErr(customError ? [customError] : []);
            }

            switch (response.status) {
              case 404:
                return fetchErr([
                  { code: 'NOT_FOUND', message: 'Resource not found' },
                ]);
              case 401:
                return fetchErr([
                  { code: 'UNAUTHORIZED', message: 'Unauthorized access' },
                ]);
              case 403:
                return fetchErr([{ code: 'FORBIDDEN', message: 'Forbidden' }]);
              case 409:
                return fetchErr([
                  { code: 'CONFLICT', message: 'Resource conflict' },
                ]);
              case 410:
                return fetchErr([
                  { code: 'GONE', message: 'Resource deleted' },
                ]);
              case 500:
                lastError = fetchErr([
                  {
                    code: 'SERVER_ERROR',
                    message: 'Internal server error',
                  },
                ]);
                break;
              default:
                return fetchErr([
                  {
                    code: 'HTTP_ERROR',
                    message: `HTTP error! status: ${response.status}`,
                  },
                ]);
            }
          } else {
            if (method === 'HEAD') return ok({} as T);

            const contentType = response.headers.get('Content-Type');
            if (!contentType) return ok({} as T);

            if (contentType.includes('text/plain')) {
              const text = await response.text();
              return ok({ contentType, body: text } as T);
            }

            if (contentType.includes('application/octet-stream')) {
              return ok(new Uint8Array(await response.arrayBuffer()) as T);
            }

            const data = await response.json();
            return ok(data as T);
          }
        } catch (error) {
          if (networkErrorKind(error)) {
            lastError = fetchErr([
              { code: 'NETWORK_ERROR', message: 'Network error occurred' },
            ]);
          } else if (error instanceof SyntaxError) {
            return fetchErr([
              { code: 'INVALID_JSON', message: 'Invalid JSON in response' },
            ]);
          } else {
            return fetchErr([
              {
                code: 'UNKNOWN_ERROR',
                message: `An unknown error occurred: ${error}`,
              },
            ]);
          }
        }

        if (attempt < maxTries) {
          await sleep(calculateDelay(delay, attempt));
        }
      }

      return (
        lastError ??
        fetchErr([
          {
            code: 'UNKNOWN_ERROR',
            message: 'Retry failed for an unknown reason',
          },
        ])
      );
    })();

    try {
      await retryBody?.cancel();
    } catch {}
    try {
      await retryRequest?.body?.cancel();
    } catch {}
    parentSpan.setAttr('safe_fetch.retry.attempts', attempts);
    parentSpan.setAttr(
      'safe_fetch.response.visible',
      lastResponseStatus !== undefined
    );
    if (lastResponseStatus !== undefined) {
      parentSpan.setAttr('http.response.status_code', lastResponseStatus);
      parentSpan.setAttr('http.status_code', lastResponseStatus);
    }
    if (result.isErr()) {
      const code = result.error[0]?.code ?? 'UNKNOWN_ERROR';
      parentSpan.setAttr('safe_fetch.error.code', code);
      const expectedResponse =
        lastResponseStatus !== undefined &&
        trace?.expectedStatusCodes?.includes(lastResponseStatus);
      if (!expectedResponse) {
        parentSpan.error({ name: 'SafeFetchError', message: code });
      }
    }
    return result;
  });
}
function calculateDelay(
  delay: 'exponential' | number,
  attempt: number
): number {
  if (typeof delay === 'number') {
    return delay;
  }
  return Math.pow(2, attempt - 1) * 500; // Exponential backoff in milliseconds
}
