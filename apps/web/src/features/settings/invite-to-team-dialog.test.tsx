import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('@queries/team/invites', () => ({
  useInviteToTeamMutation: () => ({
    isPending: false,
    mutate: mocks.mutate,
  }),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  TeamInviteLinkSection: () => null,
  CopyTeamInviteLinkButton: () => (
    <button type="button">Copy invite link</button>
  ),
}));

import { InviteToTeamDialog } from './Team';

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
});

function sendInvite(asAgent: boolean, onClose: () => void = () => {}) {
  render(() => (
    <InviteToTeamDialog
      teamId="team-1"
      canManageLink={false}
      open
      onClose={onClose}
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

  it('asks the inviter to give a heads-up with the invite link after sending', () => {
    const onClose = vi.fn();
    sendInvite(false, onClose);
    mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();

    expect(screen.getByText("Let them know it's coming")).toBeTruthy();
    expect(screen.getByText('invitee@signup.test')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Copy invite link' })
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes right away after inviting an agent', () => {
    const onClose = vi.fn();
    sendInvite(true, onClose);
    mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Let them know it's coming")).toBeNull();
  });
});
