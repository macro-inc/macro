import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
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
vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => ({
    isSuccess: true,
    data: [
      { id: 'mine', name: 'Mac mini', access: 'owner' },
      { id: 'shared', name: 'Build box', access: 'user' },
      {
        id: 'agent-computer',
        name: 'Agent computer',
        access: 'owner',
        is_agent_computer: true,
      },
    ],
  }),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  TeamInviteLinkSection: () => null,
  CopyTeamInviteLinkButton: () => (
    <button type="button">Copy invite link</button>
  ),
}));

vi.mock('./components/invite-agent-dialog', () => ({
  InviteAgentDialog: (props: {
    teamId: string;
    open: boolean;
    onClose(): void;
  }) => (
    <Show when={props.open}>
      <div role="dialog" aria-label={`Invite agent to ${props.teamId}`}>
        <button type="button" onClick={() => props.onClose()}>
          Cancel agent invite
        </button>
      </div>
    </Show>
  ),
}));

import { InviteToTeamDialog } from './Team';

const [flag, setFlag] = createSignal({ enabled: true, loading: false });
let animationStyle: HTMLStyleElement;
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  // The scrolling dialog body measures itself.
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  setFlag({ enabled: true, loading: false });
  mocks.flag = flag;
  // jsdom reports an empty animation name instead of "none", which keeps
  // Presence waiting forever for an animationend, so a closing dialog never
  // reaches its close-focus handoff.
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});

afterEach(() => {
  animationStyle.remove();
  cleanup();
  vi.unstubAllGlobals();
  mocks.mutate.mockReset();
});

function sendInvite(onClose: () => void = () => {}, runtime?: string) {
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
  if (runtime) fireEvent.click(screen.getByLabelText(runtime));
  fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
}

describe('InviteToTeamDialog', () => {
  it('invites people, not agents', () => {
    sendInvite();
    expect(screen.queryByLabelText('Invite as agent')).toBeNull();

    expect(mocks.mutate.mock.calls[0]?.[0]).toEqual({
      teamId: 'team-1',
      request: {
        invites: [{ email: 'invitee@signup.test' }],
        is_agent: false,
        harness_ids: [],
      },
    });
  });

  it.each([
    { enabled: false, loading: true },
    { enabled: false, loading: false },
  ])(
    'sends human invitations regardless of agent rollout availability: %s',
    (state) => {
      setFlag(state);
      sendInvite();
      expect(screen.queryByLabelText('Invite as agent')).toBeNull();
      expect(mocks.mutate.mock.calls[0]?.[0].request.is_agent).toBe(false);
    }
  );

  it('keeps the invitation human-only and shows the heads-up when the agent rollout switches off before sending', () => {
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
    expect(screen.queryByLabelText('Invite as agent')).toBeNull();
    setFlag({ enabled: false, loading: false });
    expect(screen.queryByLabelText('Invite as agent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(mocks.mutate.mock.calls[0]?.[0].request.is_agent).toBe(false);
    mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();
    expect(screen.getByText("Let them know it's coming")).toBeTruthy();
  });

  it('asks the inviter to give a heads-up with the invite link after sending', () => {
    const onClose = vi.fn();
    sendInvite(onClose);
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

  it('stays on the invite form when a send finishes after the dialog closed', () => {
    sendInvite();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    mocks.mutate.mock.calls[0]?.[1]?.onSuccess?.();

    expect(screen.queryByText("Let them know it's coming")).toBeNull();
  });

  it('offers only runtimes the inviter owns', () => {
    sendInvite(() => {}, 'Mac mini');

    expect(screen.queryByLabelText('Build box')).toBeNull();
    expect(screen.queryByLabelText('Agent computer')).toBeNull();
    expect(mocks.mutate.mock.calls[0]?.[0].request.harness_ids).toEqual([
      'mine',
    ]);
  });

  function renderForAgents(canInviteAgents: boolean, onClose = () => {}) {
    render(() => (
      <InviteToTeamDialog
        teamId="team-1"
        canManageLink={canInviteAgents}
        canInviteAgents={canInviteAgents}
        open
        onClose={onClose}
      />
    ));
  }

  it.each([
    { enabled: false, loading: true },
    { enabled: false, loading: false },
  ])('hides the agent entry while team agents are unavailable: %s', (state) => {
    setFlag(state);
    renderForAgents(true);
    expect(screen.queryByRole('button', { name: 'Invite agent' })).toBeNull();
  });

  it('hides the agent entry from members who are not admins', () => {
    renderForAgents(false);
    expect(screen.queryByRole('button', { name: 'Invite agent' })).toBeNull();
  });

  it('swaps to the agent invite dialog and ends the flow when it closes', async () => {
    const onClose = vi.fn();
    renderForAgents(true, onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Invite agent' }));

    expect(
      await screen.findByRole('dialog', { name: 'Invite agent to team-1' })
    ).toBeTruthy();
    expect(screen.queryByText('Invite by email')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel agent invite' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('dialog', { name: 'Invite agent to team-1' })
    ).toBeNull();
  });

  it('closes the agent invite dialog when the rollout switches off', async () => {
    const onClose = vi.fn();
    renderForAgents(true, onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Invite agent' }));
    await screen.findByRole('dialog', { name: 'Invite agent to team-1' });

    setFlag({ enabled: false, loading: false });

    expect(
      screen.queryByRole('dialog', { name: 'Invite agent to team-1' })
    ).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
