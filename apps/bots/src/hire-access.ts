import type { TeamRole } from '@macro-inc/sdk/generated/auth';

export type HireAccess =
  | { status: 'signed-out' | 'team-unresolved' | 'unavailable' }
  | {
      status: 'signed-in';
      teamId: string;
      role: TeamRole;
      computerRollout: 'on' | 'off' | 'unknown';
      roster:
        | { status: 'ready'; count: number }
        | { status: 'denied' | 'unavailable' };
      eligibility: 'denied' | 'unavailable' | 'terms-unavailable';
      offers: 'unavailable';
      purchaseEnabled: false;
    };

export function parseHireAccess(body: unknown): HireAccess {
  if (!body || typeof body !== 'object' || !('status' in body)) {
    return { status: 'unavailable' };
  }
  if (body.status === 'signed-out' || body.status === 'team-unresolved') {
    return { status: body.status };
  }
  if (
    body.status !== 'signed-in' ||
    !('teamId' in body) ||
    typeof body.teamId !== 'string' ||
    !body.teamId ||
    !('role' in body) ||
    (body.role !== 'member' &&
      body.role !== 'admin' &&
      body.role !== 'owner') ||
    !('computerRollout' in body) ||
    (body.computerRollout !== 'on' &&
      body.computerRollout !== 'off' &&
      body.computerRollout !== 'unknown') ||
    !('eligibility' in body) ||
    (body.eligibility !== 'denied' &&
      body.eligibility !== 'unavailable' &&
      body.eligibility !== 'terms-unavailable') ||
    !('roster' in body) ||
    !body.roster ||
    typeof body.roster !== 'object' ||
    !('status' in body.roster) ||
    !('purchaseEnabled' in body) ||
    body.purchaseEnabled !== false ||
    !('offers' in body) ||
    body.offers !== 'unavailable'
  ) {
    return { status: 'unavailable' };
  }

  let roster: Extract<HireAccess, { status: 'signed-in' }>['roster'];
  if (body.roster.status === 'denied' || body.roster.status === 'unavailable') {
    roster = { status: body.roster.status };
  } else if (
    body.roster.status === 'ready' &&
    'count' in body.roster &&
    typeof body.roster.count === 'number' &&
    Number.isSafeInteger(body.roster.count) &&
    body.roster.count >= 0
  ) {
    roster = { status: 'ready', count: body.roster.count };
  } else {
    return { status: 'unavailable' };
  }
  return {
    status: 'signed-in',
    teamId: body.teamId,
    role: body.role,
    computerRollout: body.computerRollout,
    eligibility: body.eligibility,
    roster,
    offers: 'unavailable',
    purchaseEnabled: false,
  };
}
