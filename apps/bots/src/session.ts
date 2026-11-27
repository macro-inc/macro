import type { Team } from '@macro-inc/sdk/generated/auth';
import { type HireAccess, parseHireAccess } from './hire-access';

type SessionStatus =
  | 'unavailable'
  | 'signed-out'
  | 'team-unresolved'
  | 'rejected'
  | 'signed-in';

export type SignInResult = { status: SessionStatus };
type SessionResult =
  | { status: Exclude<SessionStatus, 'signed-in'> }
  | { status: 'signed-in'; team: Pick<Team, 'id' | 'name'> };

async function localStatus(
  suffix = '',
  options?: RequestInit
): Promise<SessionStatus | 'code-sent'> {
  try {
    const response = await fetch(__BOTS_LOCAL_AUTH__ + suffix, options);
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'status' in body) {
      switch (body.status) {
        case 'unavailable':
        case 'signed-out':
        case 'team-unresolved':
        case 'rejected':
        case 'signed-in':
        case 'code-sent':
          return body.status;
      }
    }
  } catch {
    // A stopped or unreachable local server never grants a session.
  }
  return 'unavailable';
}

export const session = {
  async getSession(): Promise<SessionResult> {
    if (!__BOTS_LOCAL_AUTH__) return { status: 'signed-out' };
    try {
      const response = await fetch(__BOTS_LOCAL_AUTH__);
      if (!response.ok) return { status: 'unavailable' };
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'status' in body) {
        if (body.status === 'signed-out' || body.status === 'team-unresolved') {
          return { status: body.status };
        }
        if (
          body.status === 'signed-in' &&
          'team' in body &&
          body.team &&
          typeof body.team === 'object' &&
          'id' in body.team &&
          typeof body.team.id === 'string' &&
          body.team.id &&
          'name' in body.team &&
          typeof body.team.name === 'string' &&
          body.team.name
        ) {
          return {
            status: 'signed-in',
            team: { id: body.team.id, name: body.team.name },
          };
        }
      }
    } catch {
      // A stopped or unreachable local server never grants a session.
    }
    return { status: 'unavailable' };
  },
  async getHireAccess(): Promise<HireAccess> {
    if (!__BOTS_LOCAL_AUTH__) return { status: 'unavailable' };
    try {
      const response = await fetch(`${__BOTS_LOCAL_AUTH__}/hire-access`);
      if (response.status === 401) return { status: 'signed-out' };
      if (response.status === 200)
        return parseHireAccess(await response.json());
    } catch {
      // No signed data is available after a failed request.
    }
    return { status: 'unavailable' };
  },
  async begin(): Promise<boolean> {
    if (!__BOTS_LOCAL_AUTH__) return false;
    return (await localStatus('/begin', { method: 'POST' })) === 'code-sent';
  },
  async complete(code: string): Promise<SignInResult> {
    if (!__BOTS_LOCAL_AUTH__) return { status: 'unavailable' };
    const status = await localStatus('/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
    return { status: status === 'code-sent' ? 'unavailable' : status };
  },
};
