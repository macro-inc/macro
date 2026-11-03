import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  pending: false,
  error: false,
  members: [{ user_id: 'macro|member@example.com' }],
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    get isPending() {
      return fixture.pending;
    },
    get isError() {
      return fixture.error;
    },
    get data() {
      if (fixture.pending)
        throw new Error('Pending roster data must not be read');
      return { members: fixture.members };
    },
  }),
}));
vi.mock('@core/user/util', () => ({
  idToEmail: (id: string) => id.replace('macro|', ''),
  idToDisplayName: () => 'Member',
}));

import { useTeamMembers } from './team-members';

beforeEach(() => {
  fixture.pending = false;
  fixture.error = false;
});

describe('team roster availability', () => {
  it('does not suspend the picker on a pending or disabled roster', () => {
    fixture.pending = true;
    createRoot((dispose) => {
      const enabled = useTeamMembers(() => true);
      expect(enabled.users()).toEqual([]);
      expect(enabled.isLoading()).toBe(true);
      const disabled = useTeamMembers(() => false);
      expect(disabled.users()).toEqual([]);
      expect(disabled.isLoading()).toBe(false);
      dispose();
    });
  });

  it('retains cached members after a refetch error and drops them when disabled', () => {
    fixture.error = true;
    createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(true);
      const team = useTeamMembers(enabled);
      expect(team.users().map(({ id }) => id)).toEqual([
        'macro|member@example.com',
      ]);
      expect(team.isError()).toBe(true);
      setEnabled(false);
      expect(team.users()).toEqual([]);
      expect(team.isError()).toBe(false);
      dispose();
    });
  });
});
