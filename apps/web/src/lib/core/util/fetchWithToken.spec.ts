/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fetchWithToken, unsetTokenPromise } from './fetchWithToken';

const RESOURCE_URL = 'https://localhost/resource';

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response;
}

const isRefresh = (input: RequestInfo | URL) =>
  String(input).includes('/jwt/refresh');

describe('fetchWithToken refresh latch', () => {
  const originalFetch = global.fetch;
  const mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    unsetTokenPromise();
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockReset();
  });

  const refreshCalls = () =>
    mockFetch.mock.calls.filter(([input]) => isRefresh(input)).length;

  test('fires at most one doomed refresh across sequential 401s', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(400) : jsonResponse(401))
    );

    for (let i = 0; i < 3; i++) {
      const result = await fetchWithToken<{ data: string }>(RESOURCE_URL);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.some((e) => e.code === 'UNAUTHORIZED')).toBe(true);
      }
    }

    expect(refreshCalls()).toBe(1);
  });

  test('authenticated expired-token request still refreshes and retries', async () => {
    let refreshed = false;
    mockFetch.mockImplementation((input) => {
      if (isRefresh(input)) {
        refreshed = true;
        return Promise.resolve(jsonResponse(200));
      }
      return Promise.resolve(
        refreshed ? jsonResponse(200, { data: 'ok' }) : jsonResponse(401)
      );
    });

    const result = await fetchWithToken<{ data: string }>(RESOURCE_URL);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value).toEqual({ data: 'ok' });
    expect(refreshCalls()).toBe(1);
  });

  test('a successful refresh does not latch subsequent 401s', async () => {
    let refreshCount = 0;
    mockFetch.mockImplementation((input) => {
      if (isRefresh(input)) {
        refreshCount++;
        return Promise.resolve(jsonResponse(200));
      }
      // Each resource call 401s, forcing a fresh refresh every time.
      return Promise.resolve(jsonResponse(401));
    });

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    await fetchWithToken<{ data: string }>(RESOURCE_URL);

    expect(refreshCount).toBe(2);
  });

  test('a transient refresh failure (500) does not latch', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(500) : jsonResponse(401))
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    await fetchWithToken<{ data: string }>(RESOURCE_URL);

    expect(refreshCalls()).toBe(2);
  });

  test('unsetTokenPromise clears the latch so refresh is attempted again', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(400) : jsonResponse(401))
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(1);

    unsetTokenPromise();

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(2);
  });
});
