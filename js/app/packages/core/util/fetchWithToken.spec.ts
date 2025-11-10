/**
 * @vitest-environment happy-dom
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { fetchWithToken, unsetTokenPromise } from './fetchWithToken';
import { err, ok } from './maybeResult';

// Properly hoist the mock function
const mockSafeFetch = vi.hoisted(() => vi.fn());

vi.mock('./safeFetch', () => ({
  safeFetch: mockSafeFetch,
}));

describe('fetchWithToken', () => {
  beforeEach(() => {
    unsetTokenPromise();
    mockSafeFetch.mockClear();
    // Reset to default implementation
    mockSafeFetch.mockResolvedValue(ok({ data: 'mocked data' }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(() => {
    // Mock window.matchMedia for tests
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }),
    });
  });

  test('successful request', async () => {
    const result = await fetchWithToken<{ data: string }>(
      'https://localhost/api/data'
    );

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ data: 'mocked data' });
  });

  test('unauthorized error triggers token fetch and retry', async () => {
    mockSafeFetch
      .mockImplementationOnce(() =>
        Promise.resolve(err('UNAUTHORIZED', 'Unauthorized access'))
      )
      .mockImplementationOnce(() => Promise.resolve(ok({ token: 'new_token' })))
      .mockImplementationOnce(() =>
        Promise.resolve(ok({ data: 'data after token refresh' }))
      );

    const result = await fetchWithToken<{ data: string }>(
      'https://localhost/api/data'
    );

    expect(mockSafeFetch).toHaveBeenCalledTimes(3);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ data: 'data after token refresh' });
  });

  test('token fetch failure', async () => {
    mockSafeFetch
      .mockImplementationOnce(() =>
        Promise.resolve(err('UNAUTHORIZED', 'Unauthorized access'))
      )
      .mockImplementationOnce(() =>
        Promise.resolve(err('GRAPHQL_ERROR', 'Failed to fetch token'))
      );

    const result = await fetchWithToken<{ data: string }>(
      'https://localhost/api/data'
    );

    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toEqual([
      { code: 'GRAPHQL_ERROR', message: 'Failed to fetch token' },
    ]);
    expect(result[1]).toBeNull();
  });

  test('non-unauthorized error', async () => {
    mockSafeFetch.mockImplementationOnce(() =>
      Promise.resolve(err('NETWORK_ERROR', 'Network error occurred'))
    );

    const result = await fetchWithToken<{ data: string }>(
      'https://localhost/api/data'
    );

    expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual([
      { code: 'NETWORK_ERROR', message: 'Network error occurred' },
    ]);
    expect(result[1]).toBeNull();
  });

  test('unsetTokenPromise forces new token fetch on next request', async () => {
    mockSafeFetch
      .mockImplementationOnce(() => Promise.resolve(ok({ data: 'first data' })))
      .mockImplementationOnce(() =>
        Promise.resolve(ok({ data: 'second data' }))
      );

    await fetchWithToken<{ data: string }>('https://localhost/api/data');
    unsetTokenPromise();
    const result = await fetchWithToken<{ data: string }>(
      'https://localhost/api/data'
    );

    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ data: 'second data' });
  });

  test('retry configuration is passed to safeFetch', async () => {
    await fetchWithToken<{ data: string }>('https://localhost/api/data', {
      retry: { maxTries: 3, delay: 'exponential' },
    });

    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://localhost/api/data',
      expect.objectContaining({
        retry: { maxTries: 3, delay: 'exponential' },
      })
    );
  });
});
