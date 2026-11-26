import type {
  GetUserInfoResponse,
  GetUserTeamsResponse,
  SsoLoginData,
} from '@macro-inc/sdk/generated/auth';

type SessionResult =
  | { status: 'unavailable' | 'signed-out' | 'team-unresolved' }
  | {
      status: 'signed-in';
      user: GetUserInfoResponse;
      team: GetUserTeamsResponse[number];
    };

type SessionContract = {
  getSession(): Promise<SessionResult>;
  startSignIn(
    query: Pick<SsoLoginData['query'], 'original_url'>
  ): Promise<SessionResult>;
};

// The gateway adapter belongs to the local integration. This implementation
// cannot fetch, redirect to an auth host, or establish a session.
export const session: SessionContract = {
  async getSession() {
    return { status: 'signed-out' };
  },
  async startSignIn() {
    return { status: 'unavailable' };
  },
};
