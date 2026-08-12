/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import type { UserInfoData } from '@queries/auth/user-info';
import { describe, expect, test, vi } from 'vitest';
import { deriveIsAuthenticated } from './user';

vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: vi.fn(),
}));

type QueryState = Parameters<typeof deriveIsAuthenticated>[0];

function queryState(overrides: Partial<QueryState>): QueryState {
  return {
    isLoading: false,
    isError: false,
    error: null,
    data: undefined,
    ...overrides,
  } as QueryState;
}

function thrownError(code: string) {
  return new ThrownResultError([{ code, message: '' }]);
}

const authenticated = { authenticated: true } as UserInfoData;

describe('deriveIsAuthenticated', () => {
  test('loading with no data is unknown', () => {
    expect(deriveIsAuthenticated(queryState({ isLoading: true }))).toBe(
      undefined
    );
  });

  test('a 401 with no data is signed out', () => {
    expect(
      deriveIsAuthenticated(
        queryState({ isError: true, error: thrownError('UNAUTHORIZED') })
      )
    ).toBe(false);
  });

  test('a 401 wins over retained data', () => {
    expect(
      deriveIsAuthenticated(
        queryState({
          isError: true,
          error: thrownError('UNAUTHORIZED'),
          data: authenticated,
        })
      )
    ).toBe(false);
  });

  test('a transient failure with no data is unknown', () => {
    expect(
      deriveIsAuthenticated(
        queryState({ isError: true, error: thrownError('NETWORK_ERROR') })
      )
    ).toBe(undefined);
  });

  test('retained data survives a failed background refetch', () => {
    // An offline cold start restores user-info from cache, then the mount
    // refetch fails; last-known auth state must win over the transient error.
    expect(
      deriveIsAuthenticated(
        queryState({
          isError: true,
          error: thrownError('NETWORK_ERROR'),
          data: authenticated,
        })
      )
    ).toBe(true);
  });

  test('a successful unauthenticated response is signed out', () => {
    expect(
      deriveIsAuthenticated(
        queryState({ data: { authenticated: false } as UserInfoData })
      )
    ).toBe(false);
  });

  test('settled with no data and no error is signed out', () => {
    expect(deriveIsAuthenticated(queryState({}))).toBe(false);
  });
});
