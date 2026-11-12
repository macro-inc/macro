import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { expect, it } from 'vitest';
import { passwordRecipients } from '../queries/recipients';

it('limits recipient names to current-team humans and the current team', () => {
  const team: TeamWithMembers = {
    team: {
      id: 'team-1',
      name: 'Product team',
      owner_id: 'human-1',
      slug: 'product',
      allow_non_admin_invites: true,
      crm_enabled: false,
      enterprise: false,
    },
    members: [
      { team_id: 'team-1', user_id: 'human-1', role: 'owner', plan: 'premium' },
      {
        team_id: 'team-1',
        user_id: 'agent-1',
        role: 'member',
        plan: 'premium',
      },
    ],
  };
  expect(
    passwordRecipients(
      team,
      [
        {
          id: 'human-1',
          first_name: 'Avery',
          last_name: 'Lee',
          is_agent: false,
        },
        { id: 'agent-1', first_name: 'Automation', is_agent: true },
        { id: 'outside-person', first_name: 'Outside', is_agent: false },
      ],
      () => 'Unnamed person'
    )
  ).toEqual([
    { kind: 'user', id: 'human-1', name: 'Avery Lee' },
    { kind: 'team', id: 'team-1', name: 'Product team' },
  ]);
  expect(
    passwordRecipients(
      undefined,
      [{ id: 'human-1', first_name: 'Avery' }],
      () => 'Unnamed person'
    )
  ).toEqual([]);
});
