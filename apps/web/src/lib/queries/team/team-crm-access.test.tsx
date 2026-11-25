import type { PatchTeamRequest } from '@service-auth/generated/schemas/patchTeamRequest';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authKeys } from '../auth/keys';
import { teamKeys } from './keys';
import {
  useCurrentTeamQuery,
  usePatchTeamMutation,
  useTeamQuery,
} from './teams';

const api = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn() }));
const [viewer, setViewer] = createSignal('account-one');
let client: QueryClient;

vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => viewer,
  useIsAuthenticated: () => () => true,
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { patchTeam: api.patch, getTeam: api.get },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

const TEAM: TeamWithMembers = {
  team: {
    id: 'team-one',
    name: 'Example team',
    slug: 'EXAMPLE_TEAM',
    owner_id: 'owner',
    allow_non_admin_invites: true,
    prevent_completing_blocked_tasks: false,
    crm_enabled: true,
    enterprise: false,
  },
  members: [
    { user_id: 'owner', team_id: 'team-one', role: 'owner', plan: 'premium' },
    { user_id: 'admin', team_id: 'team-one', role: 'admin', plan: 'premium' },
    { user_id: 'member', team_id: 'team-one', role: 'member', plan: 'premium' },
  ],
  crm_member_access: { owner: true, admin: true, member: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  setViewer('account-one');
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer(),
    authenticated: true,
  });
  client.setQueryData(teamKeys.detail('team-one').queryKey, TEAM);
  client.setQueryData(teamKeys.currentTeam.queryKey, TEAM);
  api.patch.mockResolvedValue(ok(undefined));
  api.get.mockRejectedValue(new Error('offline'));
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('keeps a confirmed CRM toggle after the team refetch fails so the next toggle reverses it', async () => {
  let mutation!: ReturnType<typeof usePatchTeamMutation>;
  function Probe() {
    useTeamQuery(() => 'team-one');
    useCurrentTeamQuery();
    mutation = usePatchTeamMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  const refreshed = Promise.withResolvers<void>();
  let failures = 0;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') {
      failures += 1;
      if (failures === 2) refreshed.resolve();
    }
  });
  await mutation.mutateAsync({
    teamId: 'team-one',
    request: { member_crm_access: { user_id: 'member', enabled: false } },
  });
  await refreshed.promise;
  unsubscribe();
  for (const key of [
    teamKeys.detail('team-one').queryKey,
    teamKeys.currentTeam.queryKey,
  ]) {
    expect(
      client.getQueryData<TeamWithMembers>(key)?.crm_member_access
    ).toEqual({ owner: true, admin: true, member: false });
  }

  const current = client.getQueryData<TeamWithMembers>(
    teamKeys.detail('team-one').queryKey
  );
  await mutation.mutateAsync({
    teamId: 'team-one',
    request: {
      member_crm_access: {
        user_id: 'member',
        enabled: !current?.crm_member_access.member,
      },
    },
  });
  expect(api.patch).toHaveBeenLastCalledWith({
    member_crm_access: { user_id: 'member', enabled: true },
  });
});

it('does not publish a late confirmed toggle into a replacement account', async () => {
  const started = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Ok<void, never>>();
  api.patch.mockImplementation((_request: PatchTeamRequest) => {
    started.resolve();
    return response.promise;
  });
  let mutation!: ReturnType<typeof usePatchTeamMutation>;
  function Probe() {
    mutation = usePatchTeamMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  const invalidated = vi.spyOn(client, 'invalidateQueries');
  const pending = mutation.mutateAsync({
    teamId: 'team-one',
    request: {
      member_crm_access: { user_id: 'member', enabled: false },
      prevent_completing_blocked_tasks: true,
    },
  });
  await started.promise;
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: 'account-two',
    authenticated: true,
  });
  setViewer('account-two');
  response.resolve(ok(undefined));
  await pending;
  expect(client.getQueryData(teamKeys.detail('team-one').queryKey)).toEqual(
    TEAM
  );
  expect(client.getQueryData(teamKeys.currentTeam.queryKey)).toEqual(TEAM);
  expect(invalidated).not.toHaveBeenCalled();
});

it.each(['admin', 'owner', 'missing'])(
  'preserves effective role protection and missing members for %s',
  async (target) => {
    let mutation!: ReturnType<typeof usePatchTeamMutation>;
    function Probe() {
      mutation = usePatchTeamMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await mutation.mutateAsync({
      teamId: 'team-one',
      request: { member_crm_access: { user_id: target, enabled: false } },
    });
    expect(client.getQueryData(teamKeys.detail('team-one').queryKey)).toEqual(
      TEAM
    );
    expect(client.getQueryData(teamKeys.currentTeam.queryKey)).toEqual(TEAM);
  }
);

it('updates only the matching team after a committed toggle', async () => {
  const other = { ...TEAM, team: { ...TEAM.team, id: 'team-two' } };
  client.setQueryData(teamKeys.currentTeam.queryKey, other);
  let mutation!: ReturnType<typeof usePatchTeamMutation>;
  function Probe() {
    mutation = usePatchTeamMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  await mutation.mutateAsync({
    teamId: 'team-one',
    request: { member_crm_access: { user_id: 'member', enabled: false } },
  });
  expect(
    client.getQueryData<TeamWithMembers>(teamKeys.detail('team-one').queryKey)
      ?.crm_member_access.member
  ).toBe(false);
  expect(client.getQueryData(teamKeys.currentTeam.queryKey)).toEqual(other);
});

it('keeps a confirmed completion policy through refetch errors and reverses the next toggle', async () => {
  let mutation!: ReturnType<typeof usePatchTeamMutation>;
  function Probe() {
    useTeamQuery(() => 'team-one');
    useCurrentTeamQuery();
    mutation = usePatchTeamMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  const refreshed = Promise.withResolvers<void>();
  let failures = 0;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') {
      failures += 1;
      if (failures === 2) refreshed.resolve();
    }
  });
  await mutation.mutateAsync({
    teamId: 'team-one',
    request: { prevent_completing_blocked_tasks: true },
  });
  await refreshed.promise;
  unsubscribe();
  for (const key of [
    teamKeys.detail('team-one').queryKey,
    teamKeys.currentTeam.queryKey,
  ]) {
    const cached = client.getQueryData<TeamWithMembers>(key);
    expect(cached?.team.prevent_completing_blocked_tasks).toBe(true);
    expect(cached?.crm_member_access).toEqual(TEAM.crm_member_access);
  }
  const current = client.getQueryData<TeamWithMembers>(
    teamKeys.detail('team-one').queryKey
  );
  await mutation.mutateAsync({
    teamId: 'team-one',
    request: {
      prevent_completing_blocked_tasks:
        !current?.team.prevent_completing_blocked_tasks,
    },
  });
  expect(api.patch).toHaveBeenLastCalledWith({
    prevent_completing_blocked_tasks: false,
  });
  expect(
    client.getQueryData<TeamWithMembers>(teamKeys.currentTeam.queryKey)?.team
      .prevent_completing_blocked_tasks
  ).toBe(false);
});
