import { ThrownResultError } from '@core/util/result';
import type { UserInfoData } from '@queries/auth/user-info';
import { describe, expect, it, vi } from 'vitest';
import { authSession } from './auth-session';

vi.mock('@queries/auth/user-info', () => ({
  useUserInfoQuery: vi.fn(),
}));

type QueryState = Parameters<typeof authSession>[0];

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

const user = {
  authenticated: true,
  userId: 'macro|someone@example.com',
  email: 'someone@example.com',
  tutorialComplete: true,
  isAgent: false,
} as UserInfoData;

describe('authSession', () => {
  it('is loading while the first request is in flight', () => {
    expect(authSession(queryState({ isLoading: true }))).toEqual({
      t: 'loading',
    });
  });

  it('is signed out on a 401', () => {
    expect(
      authSession(
        queryState({ isError: true, error: thrownError('UNAUTHORIZED') })
      )
    ).toEqual({ t: 'signed-out' });
  });

  it('is signed out once a failed request has given up without data', () => {
    expect(
      authSession(
        queryState({ isError: true, error: thrownError('INTERNAL_ERROR') })
      )
    ).toEqual({ t: 'signed-out' });
  });

  it('stays signed in when a refresh fails with retained data', () => {
    expect(
      authSession(
        queryState({
          isError: true,
          error: thrownError('INTERNAL_ERROR'),
          data: user,
        })
      )
    ).toEqual({
      t: 'signed-in',
      user: {
        id: 'macro|someone@example.com',
        email: 'someone@example.com',
        tutorialComplete: true,
        isAgent: false,
      },
    });
  });
});
