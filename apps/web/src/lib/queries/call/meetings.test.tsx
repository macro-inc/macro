// @vitest-environment jsdom
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  joinMeeting: vi.fn(),
  joinMeetingAsGuest: vi.fn(),
  getCallLink: vi.fn(),
  getMeeting: vi.fn(),
  getMeetings: vi.fn(),
  getActiveMeetings: vi.fn(),
  getMeetingInvitePermissions: vi.fn(),
  inviteMeetingUsers: vi.fn(),
}));
vi.mock('@service-call/client', () => ({ callServiceClient: client }));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import {
  useActiveMeetingsQuery,
  useCallLinkQuery,
  useInviteMeetingUsersMutation,
  useJoinMeetingMutation,
  useMeetingInvitePermissionsQuery,
  useMeetingQuery,
  useMeetingsQuery,
} from './meetings';

beforeEach(() => {
  vi.clearAllMocks();
  client.joinMeeting.mockResolvedValue(ok({ token: 'private-token' }));
  client.joinMeetingAsGuest.mockResolvedValue(ok({ token: 'private-token' }));
});
afterEach(cleanup);

function setupMutation() {
  const queryClient = new QueryClient();
  let mutation!: ReturnType<typeof useJoinMeetingMutation>;
  function Probe() {
    mutation = useJoinMeetingMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  ));
  return { mutation, queryClient };
}

describe('meeting query capabilities', () => {
  it('checks invitation permission only in creator setup and isolates it by account', async () => {
    client.getMeetingInvitePermissions
      .mockResolvedValueOnce(ok({ canInvite: true }))
      .mockResolvedValueOnce(ok({ canInvite: false }));
    const queryClient = new QueryClient();
    const [userId, setUserId] = createSignal<string | undefined>('alice');
    const [enabled, setEnabled] = createSignal(false);
    let query!: ReturnType<typeof useMeetingInvitePermissionsQuery>;
    function Probe() {
      query = useMeetingInvitePermissionsQuery(() => 'secret', userId, enabled);
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    expect(query.fetchStatus).toBe('idle');
    expect(client.getMeetingInvitePermissions).not.toHaveBeenCalled();
    setEnabled(true);
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data).toEqual({ canInvite: true });
    setUserId('bob');
    expect(query.isPending).toBe(true);
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data).toEqual({ canInvite: false });
    setUserId(undefined);
    expect(query.fetchStatus).toBe('idle');
    expect(query.data).toBeUndefined();
    queryClient.clear();
  });

  it('rings one explicit teammate batch and propagates failure for retry', async () => {
    client.inviteMeetingUsers
      .mockResolvedValueOnce(
        err([{ code: 'FORBIDDEN', message: 'Not allowed' }])
      )
      .mockResolvedValueOnce(ok({}));
    const queryClient = new QueryClient();
    let mutation!: ReturnType<typeof useInviteMeetingUsersMutation>;
    function Probe() {
      mutation = useInviteMeetingUsersMutation();
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    const args = { shareToken: 'secret', userIds: ['alice', 'bob'] };
    await expect(mutation.mutateAsync(args)).rejects.toThrow();
    await mutation.mutateAsync(args);
    expect(client.inviteMeetingUsers).toHaveBeenNthCalledWith(2, 'secret', [
      'alice',
      'bob',
    ]);
    queryClient.clear();
  });
  it('keeps participating live meetings separate from the owner-only management list', async () => {
    client.getActiveMeetings.mockResolvedValue(
      ok([{ id: 'another-hosts-call' }])
    );
    const queryClient = new QueryClient();
    let query!: ReturnType<typeof useActiveMeetingsQuery>;
    function Probe() {
      query = useActiveMeetingsQuery(() => 'alice');
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data).toEqual([{ id: 'another-hosts-call' }]);
    expect(client.getMeetings).not.toHaveBeenCalled();
    queryClient.clear();
  });
  it('does not fetch active meetings until an account is available', async () => {
    client.getActiveMeetings.mockResolvedValue(ok([]));
    const queryClient = new QueryClient();
    const [userId, setUserId] = createSignal<string | undefined>();
    let query!: ReturnType<typeof useActiveMeetingsQuery>;
    function Probe() {
      query = useActiveMeetingsQuery(userId);
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    await Promise.resolve();
    expect(client.getActiveMeetings).not.toHaveBeenCalled();
    expect(query.fetchStatus).toBe('idle');
    setUserId('alice');
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(client.getActiveMeetings).toHaveBeenCalledOnce();
    queryClient.clear();
  });
  it("does not show a previous account's active meetings while the next account loads", async () => {
    client.getActiveMeetings
      .mockResolvedValueOnce(ok([{ id: 'alice-call' }]))
      .mockImplementationOnce(() => new Promise(() => {}));
    const queryClient = new QueryClient();
    const [userId, setUserId] = createSignal<string | undefined>('alice');
    let query!: ReturnType<typeof useActiveMeetingsQuery>;
    function Probe() {
      query = useActiveMeetingsQuery(userId);
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    expect(query.data).toEqual([{ id: 'alice-call' }]);
    setUserId('bob');
    await vi.waitFor(() =>
      expect(client.getActiveMeetings).toHaveBeenCalledTimes(2)
    );
    expect(query.isPending).toBe(true);
    expect(query.data).toBeUndefined();
    setUserId(undefined);
    expect(query.fetchStatus).toBe('idle');
    expect(query.data).toBeUndefined();
    expect(client.getActiveMeetings).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });
  it('stops retries and polling on older servers, but allows a manual retry', async () => {
    client.getMeetings.mockResolvedValue(
      err([{ code: 'MEETINGS_UNAVAILABLE', message: 'Unavailable' }])
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 1 } },
    });
    let query!: ReturnType<typeof useMeetingsQuery>;
    function Probe() {
      query = useMeetingsQuery({ refetchInterval: 10 });
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    await vi.waitFor(() => expect(query.isError).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(client.getMeetings).toHaveBeenCalledTimes(1);
    client.getMeetings.mockResolvedValue(ok([]));
    await query.refetch();
    await vi.waitFor(() => expect(query.isSuccess).toBe(true));
    queryClient.clear();
  });
  it('selects guest join only when a display name is supplied', async () => {
    const { mutation } = setupMutation();
    await mutation.mutateAsync({ shareToken: 'secret', displayName: 'Taylor' });
    expect(client.joinMeetingAsGuest).toHaveBeenCalledWith('secret', 'Taylor');
    expect(client.joinMeeting).not.toHaveBeenCalled();
  });
  it('uses account identity for signed-in joins and never persists credentials', async () => {
    const { mutation, queryClient } = setupMutation();
    await mutation.mutateAsync({ shareToken: 'secret' });
    expect(client.joinMeeting).toHaveBeenCalledWith('secret');
    expect(client.joinMeetingAsGuest).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()[0].options.gcTime).toBe(0);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
  it('does not fetch links or metadata without resource identifiers', async () => {
    const queryClient = new QueryClient();
    function Probe() {
      useCallLinkQuery(() => undefined);
      useMeetingQuery(() => '');
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ));
    await Promise.resolve();
    expect(client.getCallLink).not.toHaveBeenCalled();
    expect(client.getMeeting).not.toHaveBeenCalled();
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .every((query) => query.state.fetchStatus === 'idle')
    ).toBe(true);
  });
});
