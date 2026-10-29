/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getNativeNetworkAbortSignal } from '../mobile/native-network-status';

import {
  confirmSessionExpired,
  fetchToken,
  fetchWithToken,
  unsetTokenPromise,
} from './fetchWithToken';

const nativeNetwork = vi.hoisted(() => ({ controller: new AbortController() }));
vi.mock('../mobile/native-network-status', () => ({
  getNativeNetworkAbortSignal: vi.fn(() => nativeNetwork.controller.signal),
}));

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
    nativeNetwork.controller = new AbortController();
    vi.mocked(getNativeNetworkAbortSignal).mockImplementation(
      () => nativeNetwork.controller.signal
    );
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const refreshCalls = () =>
    mockFetch.mock.calls.filter(([input]) => isRefresh(input)).length;

  test('refreshes on runtimes without AbortSignal.any', async () => {
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('AbortSignal.any is unavailable');
    });
    mockFetch.mockResolvedValue(jsonResponse(200));

    expect((await fetchToken()).isOk()).toBe(true);
  });

  test('clears failed refresh setup and its timer so the next caller can retry', async () => {
    vi.useFakeTimers();
    vi.mocked(getNativeNetworkAbortSignal).mockImplementationOnce(() => {
      throw new Error('Reachability setup failed');
    });
    mockFetch.mockResolvedValue(jsonResponse(200));

    await expect(fetchToken()).rejects.toThrow('Reachability setup failed');
    expect(vi.getTimerCount()).toBe(0);
    expect((await fetchToken()).isOk()).toBe(true);
    expect(refreshCalls()).toBe(1);
  });

  test('a stalled refresh times out and permits retry without expiring the session', async () => {
    vi.useFakeTimers();
    const response = deferred<Response>();
    const started = Promise.withResolvers<void>();
    let refreshSignal: AbortSignal | null | undefined;
    mockFetch.mockImplementation((_input, init) => {
      refreshSignal = init?.signal;
      started.resolve();
      // Model a native bridge that does not settle when aborted.
      return response.promise;
    });

    const first = fetchToken();
    await started.promise;
    await vi.advanceTimersByTimeAsync(12_000);

    expect(refreshSignal?.aborted).toBe(true);
    const result = await first;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual([
        { code: 'NETWORK_ERROR', message: 'Authentication refresh timed out' },
      ]);
    }

    mockFetch.mockResolvedValue(jsonResponse(200));
    await expect(confirmSessionExpired()).resolves.toBe(false);
    expect(refreshCalls()).toBe(2);

    // The retired refresh must not latch its late rejection over a new session.
    response.resolve(textResponse(400, REFRESH_REJECTED_BODY));
    await vi.advanceTimersByTimeAsync(0);
    expect((await fetchToken()).isOk()).toBe(true);
    expect(refreshCalls()).toBe(3);
  });

  test('cancels one caller while preserving the shared refresh for another', async () => {
    const response = deferred<Response>();
    const started = Promise.withResolvers<void>();
    let refreshSignal: AbortSignal | null | undefined;
    mockFetch.mockImplementation((input, init) => {
      if (isRefresh(input)) {
        refreshSignal = init?.signal;
        started.resolve();
        return response.promise;
      }
      return Promise.resolve(jsonResponse(401));
    });
    const controller = new AbortController();
    const request = fetchWithToken(RESOURCE_URL, { signal: controller.signal });
    await started.promise;
    const other = fetchToken();
    controller.abort();

    const result = await request;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error[0]?.code).toBe('NETWORK_ERROR');
    expect(refreshSignal?.aborted).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    response.resolve(jsonResponse(200));
    expect((await other).isOk()).toBe(true);
    expect(refreshCalls()).toBe(1);
  });

  test('does not start refresh for an already cancelled caller', async () => {
    const controller = new AbortController();
    controller.abort();

    expect((await fetchToken(controller.signal)).isErr()).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('releases a stalled refresh when native connectivity drops and retries online', async () => {
    const started = Promise.withResolvers<void>();
    const response = deferred<Response>();
    mockFetch.mockImplementation(() => {
      started.resolve();
      return response.promise;
    });
    const first = fetchToken();
    await started.promise;

    expect(getNativeNetworkAbortSignal()).toBe(nativeNetwork.controller.signal);
    nativeNetwork.controller.abort();
    expect(mockFetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    const result = await first;
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error[0]?.code).toBe('NETWORK_ERROR');

    nativeNetwork.controller = new AbortController();
    mockFetch.mockResolvedValue(jsonResponse(200));
    expect((await fetchToken()).isOk()).toBe(true);
    expect(refreshCalls()).toBe(2);
    response.resolve(jsonResponse(200));
  });

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
