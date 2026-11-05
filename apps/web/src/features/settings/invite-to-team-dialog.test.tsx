import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@queries/team/invites', () => ({
  useInviteToTeamMutation: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    isSuccess: true,
    data: [
      { id: 'mine', name: 'Mac mini', access: 'owner' },
      { id: 'shared', name: 'Build box', access: 'use' },
    ],
  }),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  TeamInviteLinkSection: () => null,
}));

import { InviteToTeamDialog } from './Team';

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
});

function sendInvite(asAgent: boolean, runtime?: string) {
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
  if (runtime) fireEvent.click(screen.getByLabelText(runtime));
  fireEvent.click(screen.getByRole('button', { name: 'Send Invite' }));
}

describe('InviteToTeamDialog', () => {
  it('invites a person by default', () => {
    sendInvite(false);

    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      teamId: 'team-1',
      request: {
        invites: [{ email: 'invitee@signup.test' }],
        is_agent: false,
        harness_ids: [],
      },
    });
  });

  it('invites an agent when asked', () => {
    sendInvite(true);

    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      teamId: 'team-1',
      request: {
        invites: [{ email: 'invitee@signup.test' }],
        is_agent: true,
        harness_ids: [],
      },
    });
  });

  it('offers only runtimes the inviter owns', () => {
    sendInvite(false, 'Mac mini');

    expect(screen.queryByLabelText('Build box')).toBeNull();
    expect(mocks.mutate.mock.calls[0]?.[0].request.harness_ids).toEqual([
      'mine',
    ]);
  });
});
