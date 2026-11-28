import type {
  GetUserInfoResponse,
  TeamWithMembers,
} from '@macro-inc/sdk/generated/auth';
import { createContext, type Resource, useContext } from 'solid-js';

export type SessionResult =
  | { status: 'unavailable' | 'signed-out' | 'team-unresolved' }
  | {
      status: 'signed-in';
      user: GetUserInfoResponse;
      team: TeamWithMembers['team'];
    };

export const session = {
  async getSession(): Promise<SessionResult> {
    if (!__BOTS_NATIVE__) return { status: 'signed-out' };

    try {
      const { Sdk } = await import('@macro-inc/sdk/generated/auth');
      const auth = new Sdk();
      const options = {
        baseUrl: new URL('/auth', window.location.origin).href,
        credentials: 'same-origin' as const,
      };
      const viewer = await auth.getUserInfo(options);
      const user = viewer.data;
      if (viewer.response?.status === 401) return { status: 'signed-out' };
      if (!user?.user_id) return { status: 'unavailable' };

      const current = await auth.getTeam(options);
      if (current.response?.status === 401) return { status: 'signed-out' };
      if (!current.response || current.response.status >= 500) {
        return { status: 'unavailable' };
      }
      if (
        !current.data?.team.id ||
        !current.data.members.some((member) => member.user_id === user.user_id)
      ) {
        return { status: 'team-unresolved' };
      }

      return {
        status: 'signed-in',
        user,
        team: current.data.team,
      };
    } catch {
      return { status: 'unavailable' };
    }
  },
};

export const SessionContext = createContext<Resource<SessionResult>>();

export function useSession(): Resource<SessionResult> {
  const identity = useContext(SessionContext);
  if (!identity) throw new Error('Bots requires a session provider');
  return identity;
}
