/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { isErr, isOk } from './maybeResult';
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

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const [, data] = result;
      expect(data).toEqual({ data: 'test' });
    }
  });

  test('handle network errors', async () => {
    mockFetch.mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch');
    });

    const result = await safeFetch<{ data: string }>('https://localhost/data');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const [[{ code }]] = result;
      expect(code).toBe('NETWORK_ERROR');
    }
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

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const [, data] = result;
      expect(data).toEqual({ data: 'retry success' });
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const [[{ code }]] = result;
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        const [[{ code }]] = result;
        expect(code).toBe('NOT_FOUND');
      }
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        const [[{ code }]] = result;
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        const [[{ code }]] = result;
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        const [[{ code }]] = result;
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

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        const [[{ code, message }]] = result;
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

      expect(isErr(result)).toBe(true);
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

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        const [, data] = result;
        expect(data).toEqual({ data: 'success after retries' });
      }
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(Date.now()).toBe(startTime + 7000);
    });
  });
});
