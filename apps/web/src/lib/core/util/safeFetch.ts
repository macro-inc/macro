import { SERVER_HOSTS, SYNC_SERVICE_HOSTS } from '@core/constant/servers';
// Only the OTel API package (tiny, dependency-free) — never the SDK. Until a
// Telemetry initializes the provider, while the tracer and propagator below
// context manager and propagator below are all no-ops, so untraced users pay
// nothing beyond a URL parse per request.
import {
  context,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { err, ok, type Result } from 'neverthrow';
import { platformFetch } from './platformFetch';
import type { ObjectLike, ResultError } from './result';
import { sleep } from './sleep';

/**
 * Origins that may receive trace headers: Macro's own service hosts (direct
 * or via the local reverse proxy), the sync-service worker, and the app's own
 * origin. `traceparent` must never go to third-party origins — it leaks trace
 * ids and can break CORS preflights.
 */
const tracedOrigins: ReadonlySet<string> = (() => {
  const origins = new Set<string>();
  for (const host of [
    ...Object.values(SERVER_HOSTS),
    SYNC_SERVICE_HOSTS.worker,
  ]) {
    try {
      origins.add(new URL(host).origin);
    } catch {
      // Not a parseable URL; skip.
    }
  }
  if (typeof window !== 'undefined') origins.add(window.location.origin);
  return origins;
})();

function isTracedOrigin(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
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

/**
 * The app-wide HTTP tracing chokepoint: every request through
 * {@link safeFetch} (and its wrappers `fetchWithToken` / `fetchWithAuth`)
 * becomes an `http <METHOD> <path>` client span, parented to the ambient
 * OTel context (e.g. a `Transaction.run` root; a root span when nothing
 * is active). Macro-origin requests also get a `traceparent` header so the
 * backend's request span joins the same trace.
 */
// The proxy tracer resolves against whatever provider registers later.
const tracer = trace.getTracer('web-app');

function recordSpanError(span: Span, error: unknown): void {
  const exception =
    error instanceof Error ||
    typeof error === 'string' ||
    (typeof error === 'object' && error !== null && 'message' in error)
      ? (error as Error | string)
      : String(error);
  span.recordException(exception);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message:
      typeof exception === 'string' ? exception : (exception.message ?? ''),
  });
}

function tracedFetch(
  input: RequestInfo,
  init: RequestInit & { headers: Record<string, string> },
  traceOptions?: SafeFetchTraceOptions
): Promise<Response> {
  const url = requestUrl(input);
  if (!url) return platformFetch(input, init);
  const method = (init.method ?? 'GET').toUpperCase();
  return tracer.startActiveSpan(
    `http ${method} ${url.pathname}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': method,
        // Path only: query strings can carry tokens.
        'http.url': `${url.origin}${url.pathname}`,
      },
    },
    async (span) => {
      try {
        // Inject inside the span's context so the backend's request span
        // parents under this http span, not the flow root.
        if (isTracedOrigin(url)) {
          propagation.inject(context.active(), init.headers);
        }
        const response = await platformFetch(input, init);
        span.setAttribute('http.status_code', response.status);
        if (!response.ok) {
          const expected = traceOptions?.expectedStatusCodes?.includes(
            response.status
          );
          if (expected) {
            span.setAttribute('http.expected_status', true);
            return response;
          }
          // An error response has no JS exception, so record a synthetic
          // one: the message says what failed, and the (async) stack shows
          // which call path issued the request.
          const message = `HTTP ${response.status} for ${method} ${url.pathname}`;
          recordSpanError(span, {
            name: 'HttpError',
            message,
            stack: new Error(message).stack,
          });
        }
        return response;
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    }
  );
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
  type ErrorCode = BaseFetchErrorCode | CustomErrorCode;
  const fetchErr = (errors: ResultError<ErrorCode>[]) =>
    err<T, ResultError<ErrorCode>[]>(errors);
  let lastError: Result<T, ResultError<ErrorCode>[]> | undefined;

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const response = await tracedFetch(
        input,
        {
          ...fetchInit,
          headers: {
            ...(fetchInit?.method !== 'GET' &&
              fetchInit?.method !== 'HEAD' &&
              !(fetchInit?.body instanceof FormData) && {
                'Content-Type':
                  (fetchInit?.headers as Record<string, string> | undefined)?.[
                    'Content-Type'
                  ] ?? 'application/json',
              }),
            ...fetchInit?.headers,
          } as Record<string, string>,
        },
        trace
      );

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
            return fetchErr([{ code: 'GONE', message: 'Resource deleted' }]);
          case 500:
            lastError = fetchErr([
              { code: 'SERVER_ERROR', message: 'Internal server error' },
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
        if (fetchInit.method === 'HEAD') return ok({} as T);

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
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
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
