import { authKeys } from '@queries/auth/keys';
import { teamKeys } from '@queries/team/keys';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmMemberAccessSection } from './crm-member-access';

const state = vi.hoisted(() => ({
  viewer: 'macro|maya@example.com',
  accessChanges: true,
  agentTeammates: false,
  patch: vi.fn(),
  listAgents: vi.fn(),
}));
let client: QueryClient;

vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => state.viewer,
  useIsAuthenticated: () => () => true,
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    patchTeam: state.patch,
    getTeam: vi.fn(async () => {
      throw new Error('offline');
    }),
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      (flag.key === 'enable-crm-member-access-changes' &&
        state.accessChanges) ||
      (flag.key === 'enable-agent-teammates' && state.agentTeammates),
    loading: false,
  }),
}));
vi.mock('@service-auth/team-agents', () => ({
  teamAgentsClient: { list: state.listAgents },
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/user', async (original) => ({
  ...(await original<typeof import('@core/user')>()),
  getDisplayName: (id: string | undefined) =>
    ({
      'macro|maya@example.com': 'Maya Chen',
      'macro|sam@example.com': 'Sam Rivera',
      'macro|leo@example.com': 'Leo Novak',
    })[id ?? ''] ?? '',
  isAgentAccount: () => false,
}));

const TEAM: TeamWithMembers = {
  team: {
    id: 'team-one',
    name: 'Northwind',
    slug: 'NORTHWIND',
    owner_id: 'macro|maya@example.com',
    allow_non_admin_invites: true,
    crm_enabled: true,
    enterprise: false,
  },
  members: [
    {
      user_id: 'macro|leo@example.com',
      team_id: 'team-one',
      role: 'member',
      plan: 'premium',
    },
    {
      user_id: 'macro|sam@example.com',
      team_id: 'team-one',
      role: 'admin',
      plan: 'premium',
    },
    {
      user_id: 'macro|maya@example.com',
      team_id: 'team-one',
      role: 'owner',
      plan: 'premium',
    },
    {
      user_id: 'macro|ada@agents.example.com',
      team_id: 'team-one',
      role: 'member',
      plan: 'premium',
    },
  ],
  crm_member_access: {},
};

function renderSection() {
  render(() => (
    <QueryClientProvider client={client}>
      <CrmMemberAccessSection />
    </QueryClientProvider>
  ));
}

function accessSwitch(name: string) {
  return screen.getByRole<HTMLInputElement>('switch', {
    name: `CRM access for ${name}`,
  });
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  state.viewer = 'macro|maya@example.com';
  state.accessChanges = true;
  state.agentTeammates = false;
  state.listAgents.mockReset();
  state.patch.mockReset();
  state.patch.mockResolvedValue(ok(undefined));
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: state.viewer,
    authenticated: true,
  });
  client.setQueryData(teamKeys.currentTeam.queryKey, TEAM);
});

afterEach(() => {
  cleanup();
  client.clear();
});

it("turns a member's CRM access off and back on, saving the team setting each time", async () => {
  renderSection();
  const leo = accessSwitch('Leo Novak');
  expect(leo.checked).toBe(true);

  fireEvent.click(leo);
  await waitFor(() => expect(leo.checked).toBe(false));
  expect(state.patch).toHaveBeenLastCalledWith({
    member_crm_access: { user_id: 'macro|leo@example.com', enabled: false },
  });

  fireEvent.click(leo);
  await waitFor(() => expect(leo.checked).toBe(true));
  expect(state.patch).toHaveBeenLastCalledWith({
    member_crm_access: { user_id: 'macro|leo@example.com', enabled: true },
  });
});

it('lists owners first and keeps owners and admins on, with the reason on their row', () => {
  renderSection();
  const rows = [...document.querySelectorAll('[data-team-member]')];
  // Without agent teammates on, an agent's account lists as a person, as in Members.
  expect(rows.map((row) => row.getAttribute('data-team-member'))).toEqual([
    'macro|maya@example.com',
    'macro|sam@example.com',
    'macro|ada@agents.example.com',
    'macro|leo@example.com',
  ]);
  for (const name of ['Maya Chen', 'Sam Rivera']) {
    expect(accessSwitch(name).checked).toBe(true);
    expect(accessSwitch(name).disabled).toBe(true);
  }
  expect(screen.getByText('Owner · Always has CRM access')).toBeTruthy();
  expect(screen.getByText('Admin · Always has CRM access')).toBeTruthy();
});

it('keeps the previous state when a save fails, and saves on the next try', async () => {
  state.patch.mockResolvedValueOnce(
    err([{ code: 'NETWORK_ERROR', message: 'Unavailable' }])
  );
  renderSection();
  const leo = accessSwitch('Leo Novak');

  fireEvent.click(leo);
  await waitFor(() => expect(leo.disabled).toBe(false));
  expect(leo.checked).toBe(true);

  fireEvent.click(leo);
  await waitFor(() => expect(leo.checked).toBe(false));
  expect(state.patch).toHaveBeenCalledTimes(2);
});

it('waits for the agent teammates, offering a retry when they cannot be read', async () => {
  state.agentTeammates = true;
  state.listAgents.mockResolvedValueOnce(
    err([{ code: 'NETWORK_ERROR', message: 'Unavailable' }])
  );
  renderSection();

  const retry = await screen.findByRole('button', { name: 'Try again' });
  expect(screen.getByRole('alert').textContent).toBe(
    "Couldn't load who can use CRM."
  );
  expect(screen.queryAllByRole('switch')).toHaveLength(0);

  state.listAgents.mockResolvedValueOnce(
    ok({ agents: [{ userId: 'macro|ada@agents.example.com' }] })
  );
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryAllByRole('switch')).toHaveLength(3));
  expect(
    document.querySelector('[data-team-member="macro|ada@agents.example.com"]')
  ).toBeNull();
});

it('lists everyone when the server refuses the agent teammates read, as Members does', async () => {
  state.agentTeammates = true;
  state.listAgents.mockResolvedValue(
    err([{ code: 'FORBIDDEN', message: 'Forbidden' }])
  );
  renderSection();

  await waitFor(() => expect(screen.queryAllByRole('switch')).toHaveLength(4));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it.each([
  ['a member', 'macro|leo@example.com', true],
  ['an owner without the rollout', 'macro|maya@example.com', false],
])('shows %s nothing', (_who, viewer, accessChanges) => {
  state.viewer = viewer;
  state.accessChanges = accessChanges;
  renderSection();
  expect(screen.queryByText('Who can use CRM')).toBeNull();
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
});
