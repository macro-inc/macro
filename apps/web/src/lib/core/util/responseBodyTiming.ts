import type { Span } from '@macro-inc/observability';

/** How a response body ended, recorded as `<prefix>.body_outcome`. */
export type ResponseBodyOutcome =
  /** The first read finished. */
  | 'complete'
  /** The first read failed: the connection broke mid-body, or invalid JSON. */
  | 'error'
  /** The request's signal was aborted while the body was read. */
  | 'aborted'
  /** Nothing read the body before it was released. */
  | 'unread'
  /** A read was still running when the body was released. */
  | 'incomplete'
  /** A streamed response (event stream, multipart); not timed. */
  | 'stream'
  /** The response has no body. */
  | 'empty';

export interface ResponseBodyTimingOptions {
  /** Attribute namespace. */
  prefix: 'http' | 'graphql';
  /** `performance.now()` when the response headers arrived. */
  headersAt: number;
  /** The request's signal, to tell an abort from a failure. */
  signal?: AbortSignal | null;
  /** Release the body this long after headers if it is still not settled. */
  waitMs?: number;
  /** Called once, after the outcome is recorded on the span. */
  onSettled: () => void;
}

export interface ResponseBodyTiming {
  /** Settle as `unread` (or `incomplete`) if the body has not settled yet. */
  release(): void;
}

const BODY_READS = [
  'arrayBuffer',
  'blob',
  'bytes',
  'formData',
  'json',
  'text',
] as const;

// Responses whose body may stay open for as long as the server streams.
const STREAMING_CONTENT_TYPE =
  /^\s*(?:text\/event-stream|multipart\/|application\/(?:x-)?ndjson)/i;

/**
 * Records on `span` how long the body of `response` took after its headers:
 * `<prefix>.body_ms` and `<prefix>.body_outcome`, then calls `onSettled`.
 *
 * It replaces the response's own body-reading methods (`json()`, `text()`,
 * ...) with ones that note when the first read settles and return its result
 * unchanged. Nothing touches the body stream, so there is no extra copy or
 * native read, and a clone's reads are not counted. A streamed response is
 * settled at once and never timed, so no span waits on a long-lived stream.
 */
export function timeResponseBody(
  response: Response,
  span: Span,
  options: ResponseBodyTimingOptions
): ResponseBodyTiming {
  const { prefix, headersAt, signal, onSettled } = options;
  let reading = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settle = (outcome: ResponseBodyOutcome, endedAt?: number) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (endedAt !== undefined)
      span.setAttr(`${prefix}.body_ms`, endedAt - headersAt);
    span.setAttr(`${prefix}.body_outcome`, outcome);
    onSettled();
  };
  const release = () => settle(reading ? 'incomplete' : 'unread');

  if (!response.body) {
    settle('empty');
    return { release };
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (STREAMING_CONTENT_TYPE.test(contentType)) {
    settle('stream');
    return { release };
  }

  // Only the first read is timed: a second one fails at once (the body is
  // used) and must not settle the first as an error.
  for (const name of BODY_READS) {
    const read: unknown = response[name];
    if (typeof read !== 'function') continue;
    Reflect.defineProperty(response, name, {
      configurable: true,
      writable: true,
      value: async function timedRead(this: Response, ...args: unknown[]) {
        if (reading || settled) return Reflect.apply(read, this, args);
        reading = true;
        try {
          const value: unknown = await Reflect.apply(read, this, args);
          settle('complete', performance.now());
          return value;
        } catch (error) {
          const aborted =
            signal?.aborted === true ||
            (error instanceof Error && error.name === 'AbortError');
          settle(aborted ? 'aborted' : 'error', performance.now());
          throw error;
        }
      },
    });
  }

  if (options.waitMs !== undefined) {
    const remaining = headersAt + options.waitMs - performance.now();
    timer = setTimeout(release, Math.max(0, remaining));
  }
  return { release };
}
