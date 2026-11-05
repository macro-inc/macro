import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  flag: () => ({ enabled: true, loading: false }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => mocks.flag(),
}));

vi.mock('@queries/team/invites', () => ({
  useInviteToTeamMutation: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  TeamInviteLinkSection: () => null,
}));

import { InviteToTeamDialog } from './Team';

const [flag, setFlag] = createSignal({ enabled: true, loading: false });
beforeEach(() => {
  setFlag({ enabled: true, loading: false });
  mocks.flag = flag;
});

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
});

function sendInvite(asAgent: boolean) {
  render(() => (
    <InviteToTeamDialog
      teamId="team-1"
      canManageLink={false}
      open
      onClose={() => {}}
    />
  ));

  const email = screen.getByRole('textbox');
  fireEvent.input(email, { target: { value: 'invitee@signup.test' } });
  if (asAgent) fireEvent.click(screen.getByLabelText('Invite as agent'));
  fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));
}

describe('InviteToTeamDialog', () => {
  it('invites a person by default', () => {
    sendInvite(false);

    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      teamId: 'team-1',
      request: { invites: [{ email: 'invitee@signup.test' }], is_agent: false },
    });
  });

  it('invites an agent when asked', () => {
    sendInvite(true);

    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      teamId: 'team-1',
      request: { invites: [{ email: 'invitee@signup.test' }], is_agent: true },
    });
  });

  it.each([
    { enabled: false, loading: true },
    { enabled: false, loading: false },
  ])(
    'keeps human invitations while agent invitations are unavailable: %s',
    (state) => {
      setFlag(state);
      sendInvite(false);
      expect(screen.queryByLabelText('Invite as agent')).toBeNull();
      expect(mocks.mutate.mock.calls[0]?.[0].request.is_agent).toBe(false);
    }
  );

  it('drops a stale agent selection when the rollout switches off before sending', () => {
    render(() => (
      <InviteToTeamDialog
        teamId="team-1"
        canManageLink={false}
        open
        onClose={() => {}}
      />
    ));
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'invitee@signup.test' },
    });
    const checkbox = screen.getByLabelText('Invite as agent');
    fireEvent.click(checkbox);
    setFlag({ enabled: false, loading: false });
    expect(screen.queryByLabelText('Invite as agent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));
    expect(mocks.mutate.mock.calls[0]?.[0].request.is_agent).toBe(false);
  });
});
