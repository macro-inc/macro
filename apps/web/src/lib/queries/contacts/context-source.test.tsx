import { queryClient } from '@queries/client';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentQueryAccount } from '../auth/account-scope';
import { authKeys } from '../auth/keys';
import { emailKeys } from '../email/keys';
import type { ContextChannel, PersonFacts } from './context-facts';
import { createContactContextSource } from './context-source';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    }),
  };
});

const VIEWER = 'macro|viewer@example.com';
const PEER = 'macro|peer@example.com';
const DM_ID = '018f0000-0000-7000-8000-000000000001';

function directMessage(viewedAt: string | null): ContextChannel {
  return {
    id: DM_ID,
    name: 'Peer',
    channelType: 'direct_message',
    updatedAt: '2025-01-01T00:00:00.000Z',
    viewedAt,
    participants: [{ userId: VIEWER }, { userId: PEER }],
    botParticipants: [],
  };
}

function mountSource(
  channels: Accessor<readonly ContextChannel[] | undefined>
) {
  let facts: Accessor<ReadonlyMap<string, PersonFacts> | undefined> = () =>
    undefined;
  const [account] = createSignal(currentQueryAccount());
  function Harness() {
    facts = createContactContextSource({
      account,
      channels,
      enabled: () => true,
    });
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  ));
  return () => facts();
}

beforeEach(() => {
  queryClient.clear();
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: VIEWER,
    authenticated: true,
  });
  queryClient.setQueryData(emailKeys.links(VIEWER).queryKey, { links: [] });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
});

it('publishes nothing until the directory is complete', () => {
  const [channels, setChannels] = createSignal<
    readonly ContextChannel[] | undefined
  >();
  const facts = mountSource(channels);
  expect(facts()).toBeUndefined();

  setChannels([directMessage('2026-01-03T00:00:00.000Z')]);
  expect(facts()?.get(PEER)?.directMessage?.timestampMs).toBe(
    Date.parse('2026-01-03T00:00:00.000Z')
  );
});

it('follows the directory as a DM is viewed', () => {
  const [channels, setChannels] = createSignal<readonly ContextChannel[]>([
    directMessage(null),
  ]);
  const facts = mountSource(channels);
  expect(facts()?.get(PEER)?.directMessage?.timestampMs).toBe(
    Date.parse('2025-01-01T00:00:00.000Z')
  );

  setChannels([directMessage('2026-01-04T00:00:00.000Z')]);
  expect(facts()?.get(PEER)?.directMessage?.timestampMs).toBe(
    Date.parse('2026-01-04T00:00:00.000Z')
  );
});

it("leaves the previous account's cached inboxes alone when its account changes", async () => {
  vi.useFakeTimers();
  try {
    const other = 'macro|other@example.com';
    const inbox = (macroId: string, address: string) => ({
      links: [
        {
          id: 'inbox',
          macro_id: macroId,
          email_address: address,
          is_primary: true,
        },
      ],
    });
    queryClient.setQueryData(
      emailKeys.links(VIEWER).queryKey,
      inbox(VIEWER, 'viewer@example.com')
    );
    queryClient.setQueryData(
      emailKeys.links(other).queryKey,
      inbox(other, 'other@example.com')
    );
    const [account, setAccount] = createSignal(currentQueryAccount());
    function Harness() {
      createContactContextSource({
        account,
        channels: () => [],
        enabled: () => true,
      });
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    ));
    await vi.advanceTimersByTimeAsync(0);
    queryClient.setQueryData(authKeys.userInfo.queryKey, {
      id: other,
      authenticated: true,
    });
    setAccount(currentQueryAccount());
    await vi.advanceTimersByTimeAsync(0);
    expect(queryClient.getQueryData(emailKeys.links(VIEWER).queryKey)).toEqual(
      inbox(VIEWER, 'viewer@example.com')
    );
  } finally {
    vi.useRealTimers();
  }
});
