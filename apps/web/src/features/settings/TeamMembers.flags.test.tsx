import { seedMockDisplayNames } from '@core/user';
import type {
  Team,
  TeamAgent,
  TeamMember,
} from '@service-auth/generated/schemas';
import { MemoryRouter } from '@solidjs/router';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileSettingsProvider } from './context/mobile-settings';
import { TeamMembers } from './TeamMembers';

function SettingsTestProvider(props: ParentProps) {
  return (
    <MobileSettingsProvider>
      <MemoryRouter root={() => props.children} />
    </MobileSettingsProvider>
  );
}

const mocks = vi.hoisted(() => ({
  read: () => ({ enabled: false, loading: true }),
  enabled: (): boolean => false,
  rosterError: false,
  refetch: vi.fn(async () => ({})),
  retry: vi.fn(),
  remove: vi.fn(),
  removeMember: vi.fn(),
  patch: vi.fn(),
  plan: vi.fn(),
  viewerRole: (): 'owner' | 'admin' | 'member' => 'owner',
  openComputer: vi.fn(),
}));
vi.mock(
  '@app/features/computer-screen/context/settings-screen-context',
  () => ({
    useSettingsComputerScreen: () => ({
      openAgentComputer: mocks.openComputer,
    }),
  })
);
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) =>
    flag.key === 'enable-team-agents'
      ? () => mocks.read()
      : () => ({ enabled: false, loading: false }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|owner@example.com',
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: () => <span>Avatar</span>,
}));
vi.mock('./Team', () => ({
  useTeamViewer: () => ({
    teamQuery: {
      isSuccess: true,
      isLoading: false,
      data: { team, members, scheduled_seat_plans: {} },
    },
    role: () => mocks.viewerRole(),
    isOwner: () => mocks.viewerRole() === 'owner',
    isAdminOrOwner: () => mocks.viewerRole() !== 'member',
    allowNonAdminInvites: () => true,
  }),
  InviteToTeamDialog: () => null,
}));
vi.mock('./components/agent-voice-dialog', () => ({
  AgentVoiceDialog: (props: { agent?: TeamAgent }) => (
    <Show when={props.agent}>
      <p>Voice settings open</p>
    </Show>
  ),
}));
vi.mock('./components/invite-agent-dialog', () => ({
  InviteAgentDialog: (props: { open: boolean }) => (
    <Show when={props.open}>
      <p>Agent invitation open</p>
    </Show>
  ),
}));
vi.mock('./TeamInviteLinkSection', () => ({
  CopyTeamInviteLinkButton: () => (
    <button type="button">Copy invite link</button>
  ),
}));
vi.mock('@queries/auth', () => ({
  useAiBillingSummaryQuery: () => ({
    isSuccess: true,
    data: { tier: 'premium', payer: 'macro|owner@example.com', seats: 2 },
  }),
}));
vi.mock('@queries/team/invites', () => ({
  useTeamInvitesQuery: () => ({ isSuccess: true, data: { invites: [] } }),
  useDeleteTeamInviteMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useResendTeamInviteMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('@queries/team/members', () => ({
  useRemoveUserFromTeamMutation: () => ({
    isPending: false,
    mutate: mocks.removeMember,
  }),
  useSetTeamMemberPlanMutation: () => ({
    isPending: false,
    mutate: mocks.plan,
  }),
}));
vi.mock('@queries/team/teams', () => ({
  usePatchTeamMutation: () => ({ isPending: false, mutate: mocks.patch }),
  useToggleAutoJoinDomainMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useToggleNonAdminInvitesMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
}));
vi.mock('@queries/team-agents', () => ({
  useTeamAgentsQuery: (_id: unknown, enabled: () => boolean) => {
    mocks.enabled = enabled;
    return {
      isSuccess: true,
      isPending: false,
      isError: mocks.rosterError,
      refetch: mocks.refetch,
      data: { agents: [agent] },
    };
  },
  useDeleteTeamAgentMutation: () => ({
    isPending: false,
    mutate: mocks.remove,
  }),
  useRetryTeamAgentMutation: () => ({ isPending: false, mutate: mocks.retry }),
}));

const team: Team = {
  id: 'team-1',
  name: 'Example',
  slug: 'example',
  owner_id: 'macro|owner@example.com',
  allow_non_admin_invites: true,
  crm_enabled: false,
  enterprise: false,
};
const members: TeamMember[] = [
  {
    user_id: 'macro|owner@example.com',
    team_id: 'team-1',
    role: 'owner',
    plan: 'premium',
  },
  {
    user_id: 'macro|agent@example.com',
    team_id: 'team-1',
    role: 'member',
    plan: 'premium',
  },
];
const agent: TeamAgent = {
  userId: 'macro|agent@example.com',
  teamId: 'team-1',
  name: 'Assistant',
  email: 'agent@example.com',
  createdAt: '2026-01-01',
  createdBy: 'macro|owner@example.com',
  status: 'failed',
  payment: 'paid',
  retryable: true,
  statusReason: 'Setup failed',
};
const [flag, setFlag] = createSignal({ enabled: false, loading: true });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rosterError = false;
  mocks.viewerRole = () => 'owner';
  vi.stubGlobal('scrollTo', vi.fn());
  setFlag({ enabled: false, loading: true });
  mocks.read = flag;
  seedMockDisplayNames([
    { id: 'macro|owner@example.com', firstName: 'Owner' },
    { id: 'macro|agent@example.com', firstName: 'Assistant', isAgent: true },
  ]);
});
afterEach(cleanup);

it('keeps agent data as an ordinary member while loading/off, with no agent management controls', async () => {
  render(() => <TeamMembers team={team} />, {
    wrapper: SettingsTestProvider,
  });
  expect(screen.getByText('Loading agent features…')).toBeTruthy();
  expect(screen.getByText('Assistant')).toBeTruthy();
  expect(screen.getByText('Agent', { exact: true })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Invite agent' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByText('Setup failed')).toBeNull();
  expect(screen.queryByText('Billed')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove member' })).toBeNull();
  expect(mocks.enabled()).toBe(false);
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByText('Loading agent features…')).toBeNull();
  expect(screen.getByText('Assistant')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Invite options' }), {
    key: 'ArrowDown',
  });
  await screen.findByRole('menuitem', { name: 'Invite a person' });
  expect(
    screen.queryByRole('menuitem', { name: 'Invite an agent' })
  ).toBeNull();
  expect(mocks.enabled()).toBe(false);
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.plan).not.toHaveBeenCalled();
  expect(mocks.removeMember).not.toHaveBeenCalled();
});

it('gates both invitation choices and stale callbacks when the remote flag switches off', () => {
  setFlag({ enabled: true, loading: false });
  render(() => <TeamMembers team={team} />, {
    wrapper: SettingsTestProvider,
  });
  expect(mocks.enabled()).toBe(true);
  expect(document.querySelectorAll('[data-member-kind="human"]')).toHaveLength(
    1
  );
  expect(document.querySelectorAll('[data-member-kind="agent"]')).toHaveLength(
    1
  );
  const invite = screen.getByRole('button', {
    name: 'Invite agent',
  });
  fireEvent.click(invite);
  expect(screen.getByText('Agent invitation open')).toBeTruthy();
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByText('Agent invitation open')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Invite agent' })).toBeNull();
  fireEvent.click(invite);
  expect(screen.queryByText('Agent invitation open')).toBeNull();
  expect(screen.getByText('Agent', { exact: true })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  expect(mocks.enabled()).toBe(false);
  setFlag({ enabled: true, loading: false });
  expect(screen.queryByText('Agent invitation open')).toBeNull();
});

it('rejects an old roster-error retry after the rollout is disabled', () => {
  mocks.rosterError = true;
  setFlag({ enabled: true, loading: false });
  render(() => <TeamMembers team={team} />, {
    wrapper: SettingsTestProvider,
  });
  const retry = screen.getByRole('button', { name: 'Try again' });
  setFlag({ enabled: false, loading: false });
  fireEvent.click(retry);
  expect(mocks.refetch).not.toHaveBeenCalled();
});

it('lets a non-admin creator open a computer without loading the management roster and revokes stale actions', async () => {
  mocks.viewerRole = () => 'member';
  setFlag({ enabled: true, loading: false });
  render(() => <TeamMembers team={team} />, {
    wrapper: SettingsTestProvider,
  });
  expect(mocks.enabled()).toBe(false);
  expect(screen.queryByRole('button', { name: 'Invite agent' })).toBeNull();

  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
    key: 'ArrowDown',
  });
  const view = await screen.findByRole('menuitem', { name: 'View computer' });
  fireEvent.keyDown(view, { key: 'Enter' });
  expect(mocks.openComputer).toHaveBeenCalledWith('macro|agent@example.com');

  setFlag({ enabled: true, loading: true });
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  fireEvent.click(view);
  expect(mocks.openComputer).toHaveBeenCalledTimes(1);
  expect(mocks.enabled()).toBe(false);
});

it('keeps voice and computer actions together and revokes voice settings with the rollout', async () => {
  setFlag({ enabled: true, loading: false });
  render(() => <TeamMembers team={team} />, {
    wrapper: SettingsTestProvider,
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), {
    key: 'ArrowDown',
  });
  expect(
    await screen.findByRole('menuitem', { name: 'View computer' })
  ).toBeTruthy();
  const voice = screen.getByRole('menuitem', { name: 'Change voice' });
  fireEvent.keyDown(voice, { key: 'Enter' });
  expect(screen.getByText('Voice settings open')).toBeTruthy();
  setFlag({ enabled: false, loading: false });
  expect(screen.queryByText('Voice settings open')).toBeNull();
  fireEvent.keyDown(voice, { key: 'Enter' });
  expect(screen.queryByText('Voice settings open')).toBeNull();
  expect(mocks.openComputer).not.toHaveBeenCalled();
});
