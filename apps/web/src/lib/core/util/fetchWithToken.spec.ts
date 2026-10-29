/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  confirmSessionExpired,
  fetchToken,
  fetchWithToken,
  unsetTokenPromise,
} from './fetchWithToken';

const RESOURCE_URL = 'https://localhost/resource';

// One of the auth service's definitive "session cannot be refreshed" bodies.
const REFRESH_REJECTED_BODY = 'no refresh token to refresh';

function jsonResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response;
}

function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('not json')),
    text: () => Promise.resolve(body),
    headers: new Headers({ 'Content-Type': 'text/plain' }),
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

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
    vi.useRealTimers();
  });

  const refreshCalls = () =>
    mockFetch.mock.calls.filter(([input]) => isRefresh(input)).length;

  test('fires at most one doomed refresh across sequential 401s', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, REFRESH_REJECTED_BODY)
          : jsonResponse(401)
      )
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

  test('a 401 from the refresh endpoint latches', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(401) : jsonResponse(401))
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    await fetchWithToken<{ data: string }>(RESOURCE_URL);

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

  test('a proxy 400 without a known rejection body does not latch', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, '<html>Bad Request</html>')
          : jsonResponse(401)
      )
    );

    const result = await fetchWithToken<{ data: string }>(RESOURCE_URL);
    await fetchWithToken<{ data: string }>(RESOURCE_URL);

    expect(refreshCalls()).toBe(2);
    // The transient failure surfaces as-is instead of masquerading as a dead
    // session.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.some((e) => e.code === 'HTTP_ERROR')).toBe(true);
      expect(result.error.some((e) => e.code === 'UNAUTHORIZED')).toBe(false);
    }
  });

  test('a gateway error (502) surfaces as HTTP_ERROR and does not latch', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(502) : jsonResponse(401))
    );

    const result = await fetchWithToken<{ data: string }>(RESOURCE_URL);
    await fetchWithToken<{ data: string }>(RESOURCE_URL);

    expect(refreshCalls()).toBe(2);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.some((e) => e.code === 'UNAUTHORIZED')).toBe(false);
    }
  });

  test('a latched failure expires after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, REFRESH_REJECTED_BODY)
          : jsonResponse(401)
      )
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(1);

    vi.setSystemTime(Date.now() + 61_000);

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(2);
  });

  test('regaining visibility clears the latch', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, REFRESH_REJECTED_BODY)
          : jsonResponse(401)
      )
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(1);

    // jsdom's visibilityState is 'visible', so this models a foregrounding.
    document.dispatchEvent(new Event('visibilitychange'));

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(2);
  });

  test('regaining connectivity clears the latch', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, REFRESH_REJECTED_BODY)
          : jsonResponse(401)
      )
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(1);

    window.dispatchEvent(new Event('online'));

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(2);
  });

  test('unsetTokenPromise clears the latch so refresh is attempted again', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, REFRESH_REJECTED_BODY)
          : jsonResponse(401)
      )
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(1);

    unsetTokenPromise();

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(2);
  });

  test('a reset while a refresh is pending neither latches nor clears newer state', async () => {
    const pending = [deferred<Response>(), deferred<Response>()];
    let idx = 0;
    mockFetch.mockImplementation((input) => {
      if (isRefresh(input)) {
        const d = pending[idx++];
        return d ? d.promise : Promise.resolve(jsonResponse(200));
      }
      return Promise.resolve(jsonResponse(401));
    });

    // R1 starts and stays in-flight.
    const p1 = fetchToken();
    // A login-style reset happens while R1 is pending.
    unsetTokenPromise();
    // R2 starts under the new generation and also stays in-flight.
    const p2 = fetchToken();
    await tick();
    expect(refreshCalls()).toBe(2);

    // R1 fails definitively under the stale generation.
    pending[0].resolve(textResponse(400, REFRESH_REJECTED_BODY));
    expect((await p1).isErr()).toBe(true);

    // R1's finally must not have cleared R2's tokenPromise: a call now dedupes
    // onto R2 instead of starting a third refresh.
    const p2b = fetchToken();
    await tick();
    expect(refreshCalls()).toBe(2);

    pending[1].resolve(jsonResponse(200));
    expect((await p2).isOk()).toBe(true);
    expect((await p2b).isOk()).toBe(true);

    // R1's stale failure must not have latched: a fresh 401 still refreshes.
    expect((await fetchToken()).isOk()).toBe(true);
    expect(refreshCalls()).toBe(3);
  });

  test('confirmSessionExpired bypasses the latch and confirms a definitive rejection', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(
        isRefresh(input)
          ? textResponse(400, REFRESH_REJECTED_BODY)
          : jsonResponse(401)
      )
    );

    await fetchWithToken<{ data: string }>(RESOURCE_URL);
    expect(refreshCalls()).toBe(1);

    // Despite the latch, confirmation must consult the server again.
    await expect(confirmSessionExpired()).resolves.toBe(true);
    expect(refreshCalls()).toBe(2);
  });

  test('confirmSessionExpired reports a transient failure as not expired', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(503) : jsonResponse(401))
    );

    await expect(confirmSessionExpired()).resolves.toBe(false);
  });

  test('confirmSessionExpired reports an alive session as not expired', async () => {
    mockFetch.mockImplementation((input) =>
      Promise.resolve(isRefresh(input) ? jsonResponse(200) : jsonResponse(401))
    );

    await expect(confirmSessionExpired()).resolves.toBe(false);
  });
});
