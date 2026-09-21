// @vitest-environment jsdom
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  joinMeeting: vi.fn(),
  joinMeetingAsGuest: vi.fn(),
  getCallLink: vi.fn(),
  getMeeting: vi.fn(),
  getMeetings: vi.fn(),
}));
vi.mock('@service-call/client', () => ({ callServiceClient: client }));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import {
  useCallLinkQuery,
  useJoinMeetingMutation,
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
