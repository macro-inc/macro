/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const telemetryRecorder = vi.hoisted(() => {
  let activeSpan: TestSpan | undefined;

  class TestSpan {
    readonly attributes: Record<string, unknown> = {};
    readonly errors: unknown[] = [];
    ended = false;

    constructor(
      readonly name: string,
      readonly parent?: TestSpan
    ) {}

    setAttr(name: string, value: unknown) {
      this.attributes[name] = value;
    }

    injectTraceHeaders(headers: Record<string, string>) {
      headers.traceparent = 'test-traceparent';
    }

    error(error: unknown) {
      this.errors.push(error);
    }

    run<T>(operation: () => T): T {
      const previous = activeSpan;
      activeSpan = this;
      try {
        const result = operation();
        if (result instanceof Promise) {
          return result.finally(() => {
            activeSpan = previous;
          }) as T;
        }
        activeSpan = previous;
        return result;
      } catch (error) {
        activeSpan = previous;
        throw error;
      }
    }

    end() {
      this.ended = true;
    }
  }

  const spans: TestSpan[] = [];
  const startSpan = (name: string) => {
    const span = new TestSpan(name, activeSpan);
    spans.push(span);
    return span;
  };

  return {
    spans,
    reset() {
      spans.length = 0;
      activeSpan = undefined;
    },
    span: (name: string, operation?: (span: TestSpan) => Promise<unknown>) => {
      const span = startSpan(name);
      if (!operation) return span;
      return span.run(async () => {
        try {
          return await operation(span);
        } finally {
          span.end();
        }
      });
    },
    clientSpan: (name: string) => startSpan(name),
  };
});

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: telemetryRecorder.span,
    clientSpan: telemetryRecorder.clientSpan,
  },
}));

import { type BaseFetchErrorCode, safeFetch } from './safeFetch';

let originalFetch = global.fetch;
let originalSetTimeout = global.setTimeout;

describe('safeFetch', () => {
  const mockFetch = vi.fn((_input: RequestInfo, _init?: RequestInit) => {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
      headers: new Headers({ 'Content-Type': 'application/json' }),
    } as Response);
  });

  beforeEach(() => {
    telemetryRecorder.reset();
    global.fetch = mockFetch as typeof fetch;
    global.setTimeout = ((fn: (...args: any[]) => any) => {
      fn();
      return 0 as any;
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    mockFetch.mockClear();
  });

  test('return data on successful fetch', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      } as Response)
    );

    const result = await safeFetch<{ data: string }>('https://localhost/data');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const data = result.value;
      expect(data).toEqual({ data: 'test' });
    }
  });

  test('handle network errors', async () => {
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch');
    });

    const result = await safeFetch<{ data: string }>('https://localhost/data');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const [{ code }] = result.error;
      expect(code).toBe('NETWORK_ERROR');
    }
    const [parent, attempt] = telemetryRecorder.spans;
    expect(parent?.attributes['safe_fetch.error.code']).toBe('NETWORK_ERROR');
    expect(attempt?.attributes).toMatchObject({
      'error.type': 'chromium_failed_to_fetch',
      'network.error.kind': 'chromium_failed_to_fetch',
      'safe_fetch.response.visible': false,
    });
  });

  test('retry on network errors when configured', async () => {
    mockFetch
      .mockImplementationOnce(() => {
        throw new TypeError('Failed to fetch');
      })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: 'retry success' }),
          headers: new Headers({ 'Content-Type': 'application/json' }),
        } as Response)
      );

    const result = await safeFetch<{ data: string }>('https://localhost/data', {
      retry: { maxTries: 2, delay: 0 },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const data = result.value;
      expect(data).toEqual({ data: 'retry success' });
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('creates one parent with child spans and fresh request IDs per attempt', async () => {
    const callerHeaders = new Headers({ Authorization: 'Bearer token' });
    mockFetch
      .mockRejectedValueOnce(
        new TypeError('NetworkError when attempting to fetch resource.')
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'retry success' }), {
          headers: {
            'Content-Length': '24',
            'Content-Type': 'application/json',
          },
        })
      );

    const result = await safeFetch<{ data: string }>(
      `${window.location.origin}/users/2e4d2c15-4f8c-478b-a157-78fd126ba539`,
      {
        method: 'POST',
        body: '{"query":"safe"}',
        headers: callerHeaders,
        retry: { maxTries: 2, delay: 0 },
        trace: { route: '/users/{userId}' },
      }
    );

    expect(result.isOk()).toBe(true);
    const [parent, firstAttempt, secondAttempt] = telemetryRecorder.spans;
    expect(parent?.name).toBe('safeFetch POST /users/{userId}');
    expect(firstAttempt?.name).toBe('HTTP POST /users/{userId}');
    expect(secondAttempt?.name).toBe('HTTP POST /users/{userId}');
    expect(firstAttempt?.parent).toBe(parent);
    expect(secondAttempt?.parent).toBe(parent);
    expect(firstAttempt?.attributes).toMatchObject({
      'http.request.method': 'POST',
      'http.request.body.size': 16,
      'safe_fetch.retry.attempt': 1,
      'safe_fetch.retry.max_tries': 2,
      'safe_fetch.response.visible': false,
      'network.error.kind': 'firefox_network_error',
    });
    expect(secondAttempt?.attributes).toMatchObject({
      'http.response.status_code': 200,
      'http.response.body.size': 24,
      'safe_fetch.retry.attempt': 2,
      'safe_fetch.response.visible': true,
    });

    const firstHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    const secondHeaders = mockFetch.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(firstHeaders['x-request-id']).toBeTruthy();
    expect(secondHeaders['x-request-id']).toBeTruthy();
    expect(firstHeaders['x-request-id']).not.toBe(
      secondHeaders['x-request-id']
    );
    expect(firstHeaders.authorization).toBe('Bearer token');
    expect(callerHeaders.has('x-request-id')).toBe(false);
  });

  test('does not add request IDs to untraced third-party origins', async () => {
    await safeFetch<{ data: string }>('https://example.com/data');

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers['x-request-id']).toBeUndefined();
  });

  test('retries Request bodies with a fresh clone and honors header replacement', async () => {
    const consumedBodies: string[] = [];
    mockFetch
      .mockImplementationOnce(async (input) => {
        consumedBodies.push(await (input as Request).text());
        throw new TypeError('Failed to fetch');
      })
      .mockImplementationOnce(async (input, init) => {
        consumedBodies.push(await (input as Request).text());
        const headers = new Headers(init?.headers);
        expect(headers.has('authorization')).toBe(false);
        expect(headers.get('x-test')).toBe('replacement');
        return new Response(JSON.stringify({ data: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      });

    const request = new Request(`${window.location.origin}/data`, {
      method: 'POST',
      headers: { Authorization: 'Bearer original' },
      body: '{"value":1}',
    });
    const result = await safeFetch<{ data: string }>(request, {
      headers: { 'x-test': 'replacement' },
      retry: { maxTries: 2, delay: 0 },
    });

    expect(result.isOk()).toBe(true);
    expect(consumedBodies).toEqual(['{"value":1}', '{"value":1}']);
  });

  test('consumes the original Request when retries are disabled', async () => {
    const request = new Request(`${window.location.origin}/data`, {
      method: 'POST',
      body: '{"value":1}',
    });
    mockFetch.mockImplementationOnce(async (input) => {
      expect(input).toBe(request);
      expect(await (input as Request).text()).toBe('{"value":1}');
      return new Response(JSON.stringify({ data: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await safeFetch<{ data: string }>(request);

    expect(result.isOk()).toBe(true);
    expect(request.bodyUsed).toBe(true);
  });

  test('tees RequestInit streams for retries', async () => {
    const consumedBodies: string[] = [];
    mockFetch
      .mockImplementationOnce(async (_input, init) => {
        consumedBodies.push(await new Response(init?.body).text());
        throw new TypeError('Failed to fetch');
      })
      .mockImplementationOnce(async (_input, init) => {
        consumedBodies.push(await new Response(init?.body).text());
        return new Response(JSON.stringify({ data: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":1}'));
        controller.close();
      },
    });

    const result = await safeFetch<{ data: string }>(
      `${window.location.origin}/data`,
      {
        method: 'POST',
        body,
        retry: { maxTries: 2, delay: 0 },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(consumedBodies).toEqual(['{"value":1}', '{"value":1}']);
  });

  test('uses the final network outcome instead of a stale retry status', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, { status: 500, statusText: 'Server Error' })
      )
      .mockRejectedValueOnce(new TypeError('Load failed'));

    const result = await safeFetch<{ data: string }>(
      `${window.location.origin}/data`,
      {
        retry: { maxTries: 2, delay: 0 },
        trace: { expectedStatusCodes: [500] },
      }
    );

    expect(result).toMatchObject({
      error: [{ code: 'NETWORK_ERROR' }],
    });
    const parent = telemetryRecorder.spans[0];
    const finalAttempt = telemetryRecorder.spans[2];
    expect(parent?.attributes['safe_fetch.response.visible']).toBe(false);
    expect(parent?.attributes['http.response.status_code']).toBeUndefined();
    expect(parent?.errors).toHaveLength(1);
    expect(finalAttempt?.attributes['network.error.kind']).toBe(
      'safari_load_failed'
    );
  });

  test('normalizes identifier path segments in fallback span names', async () => {
    await safeFetch<{ data: string }>(
      'https://localhost/documents/2e4d2c15-4f8c-478b-a157-78fd126ba539'
    );

    expect(telemetryRecorder.spans.map((span) => span.name)).toEqual([
      'safeFetch GET /documents/{id}',
      'HTTP GET /documents/{id}',
    ]);
  });

  test('handle invalid JSON', async () => {
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => {
          throw new SyntaxError('Invalid JSON');
        },
        headers: new Headers({ 'Content-Type': 'application/json' }),
      } as unknown as Response)
    );

    const result = await safeFetch<{ data: string }>('https://localhost/data');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      const [{ code }] = result.error;
      expect(code).toBe('INVALID_JSON');
    }
  });

  describe('HTTP error handling', () => {
    test('handle 404 Not Found', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response)
      );

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data'
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const [{ code }] = result.error;
        expect(code).toBe('NOT_FOUND');
      }
    });

    test('keeps an expected 404 as a NOT_FOUND result', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response)
      );

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data',
        { trace: { expectedStatusCodes: [404] } }
      );

      expect(result).toMatchObject({
        error: [{ code: 'NOT_FOUND' }],
      });
      expect(mockFetch.mock.calls[0]?.[1]).not.toHaveProperty('trace');
    });

    test('handle 401 Unauthorized', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 401,
        } as Response)
      );

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data'
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const [{ code }] = result.error;
        expect(code).toBe('UNAUTHORIZED');
      }
    });

    test('handle 500 Server Error', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response)
      );

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data'
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const [{ code }] = result.error;
        expect(code).toBe('SERVER_ERROR');
      }
    });

    test('handle other HTTP errors', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 418,
        } as Response)
      );

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data'
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const [{ code }] = result.error;
        expect(code).toBe('HTTP_ERROR');
      }
    });
  });

  describe('Custom error handling', () => {
    test('use custom error handler when provided', async () => {
      mockFetch.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'Too many requests' }),
        } as Response)
      );

      type CustomErrorCode = 'RATE_LIMITED';
      const customErrorHandler = async (response: Response) => {
        const data = await response.json();
        if (response.status === 429) {
          return {
            code: 'RATE_LIMITED' as const,
            message: data.error,
          };
        }
        return {
          code: 'UNKNOWN_ERROR' as BaseFetchErrorCode,
          message: 'Unknown error occurred',
        };
      };

      const result = await safeFetch<{ data: string }, CustomErrorCode>(
        'https://localhost/data',
        undefined,
        customErrorHandler
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        const [{ code, message }] = result.error;
        expect(code).toBe('RATE_LIMITED');
        expect(message).toBe('Too many requests');
      }
    });
  });

  describe('Retry configuration', () => {
    test('respect maxTries', async () => {
      mockFetch.mockImplementation(() => {
        throw new TypeError('Failed to fetch');
      });

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data',
        {
          retry: { maxTries: 3, delay: 0 },
        }
      );

      expect(result.isErr()).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test('use exponential backoff when configured', async () => {
      const startTime = new Date('2023-01-01T00:00:00Z').getTime();
      vi.setSystemTime(startTime);

      mockFetch
        .mockImplementationOnce(() => {
          vi.setSystemTime(startTime + 1000); // 1 second later
          throw new TypeError('Failed to fetch');
        })
        .mockImplementationOnce(() => {
          vi.setSystemTime(startTime + 3000); // 2 more seconds later (3 total)
          throw new TypeError('Failed to fetch');
        })
        .mockImplementationOnce(() => {
          vi.setSystemTime(startTime + 7000); // 4 more seconds later (7 total)
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: 'success after retries' }),
            headers: new Headers({ 'Content-Type': 'application/json' }),
          } as Response);
        });

      const result = await safeFetch<{ data: string }>(
        'https://localhost/data',
        {
          retry: { maxTries: 3, delay: 'exponential' },
        }
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const data = result.value;
        expect(data).toEqual({ data: 'success after retries' });
      }
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(Date.now()).toBe(startTime + 7000);
    });
  });
});
