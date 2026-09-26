import { authServiceClient } from '@service-auth/client';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMeetingTeammatesSource } from './meeting-teammates';

vi.mock('@service-auth/client', () => ({
  authServiceClient: { getTeam: vi.fn() },
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

const alice = 'macro|alice@example.com';
const bob = 'macro|bob@example.com';
const getTeam = vi.mocked(authServiceClient.getTeam);
const displayName = vi.fn<(userId: string) => string>();
const disposers: (() => void)[] = [];
let client: QueryClient;

function roster(ids: string[]): TeamWithMembers {
  return {
    team: {
      id: 'team-1',
      name: 'Design team',
      slug: 'design',
      owner_id: alice,
      allow_non_admin_invites: true,
      crm_enabled: false,
      enterprise: false,
    },
    members: ids.map((user_id) => ({
      user_id,
      team_id: 'team-1',
      role: 'member',
      plan: 'premium',
    })),
  };
}

function setup(initialUser: string | undefined = alice) {
  const [userId, setUserId] = createSignal<string | undefined>(initialUser);
  let source!: ReturnType<typeof useMeetingTeammatesSource>;
  function Harness() {
    source = useMeetingTeammatesSource(userId, displayName);
    return null;
  }
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(Harness, {});
      },
    });
    return dispose;
  });
  disposers.push(dispose);
  return { source, setUserId };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getTeam.mockReset();
  getTeam.mockResolvedValue(ok(roster([alice, bob])));
  displayName.mockReset();
  displayName.mockImplementation((id) => (id === bob ? 'Bob Baker' : ''));
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  client.clear();
});

it('offers named human teammates, excluding self, duplicates, bots and malformed IDs', async () => {
  getTeam.mockResolvedValue(
    ok(
      roster([
        alice,
        'macro|ALICE@example.com',
        bob,
        bob,
        'macro|BOB@example.com',
        'bot|00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000a1a1',
        'invalid',
        'macro|@',
        'macro|carol@example.com',
      ])
    )
  );
  const { source } = setup();
  expect(source.people()).toEqual([]);
  await vi.waitFor(() => expect(source.loading()).toBe(false));
  expect(source.people()).toEqual([
    { id: bob, email: 'bob@example.com', name: 'Bob Baker' },
    {
      id: 'macro|carol@example.com',
      email: 'carol@example.com',
      name: 'carol@example.com',
    },
  ]);
  expect(source.error()).toBeUndefined();
});

it("hides a previous account's roster and refreshes for the new account", async () => {
  const { source, setUserId } = setup();
  await vi.waitFor(() => expect(source.people()).toHaveLength(1));
  setUserId('macro|other@example.com');
  expect(source.people()).toEqual([]);
  expect(source.error()).toBeDefined();
  getTeam.mockResolvedValue(ok(roster(['macro|other@example.com', bob])));
  source.refresh();
  await vi.waitFor(() => expect(source.error()).toBeUndefined());
  expect(source.people()).toEqual([
    { id: bob, email: 'bob@example.com', name: 'Bob Baker' },
  ]);
});

it('does not fetch or expose cached teammates while signed out', async () => {
  const { source, setUserId } = setup('');
  await Promise.resolve();
  expect(getTeam).not.toHaveBeenCalled();
  expect(source.people()).toEqual([]);
  expect(source.loading()).toBe(false);
  setUserId(alice);
  await vi.waitFor(() => expect(source.people()).toHaveLength(1));
  setUserId(undefined);
  expect(source.people()).toEqual([]);
  source.refresh();
  expect(getTeam).toHaveBeenCalledOnce();
});

it('returns an empty list when the account has no team', async () => {
  getTeam.mockResolvedValue(ok(null));
  const { source } = setup();
  await vi.waitFor(() => expect(source.loading()).toBe(false));
  expect(source.people()).toEqual([]);
  expect(source.error()).toBeUndefined();
});

it('reports a failed roster request and permits retry', async () => {
  getTeam.mockResolvedValue(
    err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
  );
  const { source } = setup();
  await vi.waitFor(() => expect(source.error()).toBeDefined());
  expect(source.people()).toEqual([]);
  getTeam.mockResolvedValue(ok(roster([alice, bob])));
  source.refresh();
  await vi.waitFor(() => expect(source.people()).toHaveLength(1));
  expect(source.error()).toBeUndefined();
});
