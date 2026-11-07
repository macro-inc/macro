import type { HarnessResident } from '@service-storage/client';
import { describe, expect, it } from 'vitest';
import {
  residentsLosingAccessWithTeam,
  residentsLosingAccessWithUser,
} from './residents';

const resident = (
  name: string,
  owner: { user?: string; team?: string }
): HarnessResident => ({
  type: 'bot',
  bot_id: name,
  name,
  owner_user_id: owner.user ?? null,
  team_id: owner.team ?? null,
});

const residents: HarnessResident[] = [
  {
    type: 'account',
    user_id: 'agent',
    name: 'Account resident',
    team_id: 'team',
  },
  resident('owners', { user: 'owner' }),
  resident('alices', { user: 'alice' }),
  resident('bobs', { user: 'bob' }),
  resident('teams', { team: 'team' }),
];
const names = (found: HarnessResident[]) => found.map((r) => r.name);

describe('residentsLosingAccessWithUser', () => {
  it('shuts down the agents of the person losing access', () => {
    const holders = {
      ownerId: 'owner',
      grantedUserIds: ['alice'],
      teamMemberIds: [],
    };
    expect(
      names(residentsLosingAccessWithUser(residents, holders, 'alice'))
    ).toEqual(['alices']);
  });

  it('leaves them running while the team grant still covers that person', () => {
    const holders = {
      ownerId: 'owner',
      grantedUserIds: ['alice'],
      teamMemberIds: ['alice'],
    };
    expect(residentsLosingAccessWithUser(residents, holders, 'alice')).toEqual(
      []
    );
  });
});

describe('residentsLosingAccessWithTeam', () => {
  it('shuts down team agents and members without a direct grant', () => {
    const holders = {
      ownerId: 'owner',
      grantedUserIds: ['alice'],
      teamMemberIds: ['owner', 'alice', 'bob'],
    };
    expect(
      names(residentsLosingAccessWithTeam(residents, holders, 'team'))
    ).toEqual(['bobs', 'teams']);
  });
});
