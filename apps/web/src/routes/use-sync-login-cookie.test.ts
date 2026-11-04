/** @vitest-environment jsdom */
import { hasLoginCookie, syncLoginStorage } from '@core/util/cookies';
import { ThrownResultError } from '@core/util/result';
import { setEmailOutboxSession } from '@queries/email/outbox-session';
import { setGraphqlSoupSessionActive } from '@service-storage/graphql-soup';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSyncLoginCookie } from './use-sync-login-cookie';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: () => mocks.query(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  setGraphqlSoupSessionActive: vi.fn(),
}));
vi.mock('@queries/email/outbox-session', () => ({
  setEmailOutboxSession: vi.fn(),
}));

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = 'login=true; path=/';
  syncLoginStorage(true);
});
afterEach(() => {
  dispose?.();
  document.cookie = 'login=; max-age=0; path=/';
  syncLoginStorage(false);
});

it('disables the cache and clears stale login hints on a 401 with retained identity', () => {
  const [error, setError] = createSignal<Error | null>(null);
  mocks.query.mockReturnValue({
    get error() {
      return error();
    },
    get isSuccess() {
      return error() === null;
    },
    data: { authenticated: true, id: 'account' },
  });
  createRoot((cleanup) => {
    dispose = cleanup;
    useSyncLoginCookie();
  });
  expect(setGraphqlSoupSessionActive).toHaveBeenLastCalledWith(true);
  expect(setEmailOutboxSession).toHaveBeenLastCalledWith('account');

  setError(new ThrownResultError([{ code: 'UNAUTHORIZED', message: '' }]));

  expect(setGraphqlSoupSessionActive).toHaveBeenLastCalledWith(false);
  expect(setEmailOutboxSession).toHaveBeenLastCalledWith(undefined);
  expect(hasLoginCookie()).toBe(false);

  setError(null);
  expect(setGraphqlSoupSessionActive).toHaveBeenLastCalledWith(true);
  expect(setEmailOutboxSession).toHaveBeenLastCalledWith('account');
  expect(hasLoginCookie()).toBe(true);
});

it.each([null, 'NETWORK_ERROR', 'INTERNAL_SERVER_ERROR'])(
  'preserves the session for pending or transient auth failures: %s',
  (code) => {
    mocks.query.mockReturnValue({
      isSuccess: false,
      error: code ? new ThrownResultError([{ code, message: '' }]) : null,
      get data() {
        throw new Error('Must not read pending query data');
      },
    });
    createRoot((cleanup) => {
      dispose = cleanup;
      useSyncLoginCookie();
    });
    expect(setGraphqlSoupSessionActive).not.toHaveBeenCalled();
    expect(setEmailOutboxSession).not.toHaveBeenCalled();
    expect(hasLoginCookie()).toBe(true);
  }
);

it('keeps a successful signed-out response off the cache', () => {
  mocks.query.mockReturnValue({
    isSuccess: true,
    error: null,
    data: { authenticated: false },
  });
  createRoot((cleanup) => {
    dispose = cleanup;
    useSyncLoginCookie();
  });
  expect(setGraphqlSoupSessionActive).toHaveBeenCalledWith(false);
  expect(setEmailOutboxSession).toHaveBeenCalledWith(undefined);
  expect(hasLoginCookie()).toBe(false);
});
