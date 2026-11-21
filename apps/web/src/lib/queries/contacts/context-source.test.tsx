import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheChangeListener, CacheHost } from '@graphql-cache/host/types';
import {
  type HydrationSearchChanges,
  INITIAL_CACHE_REVISION,
} from '@graphql-cache/protocol';
import { queryClient } from '@queries/client';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentQueryAccount } from '../auth/account-scope';
import { authKeys } from '../auth/keys';
import { channelKeys } from '../channel/keys';
import { emailKeys } from '../email/keys';
import type { PersonFacts } from './context-facts';
import { createContactContextSource } from './context-source';
import { openContactReader } from './readers';

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
const GENERATION = '00000000-0000-4000-8000-000000000001';
const VIEWED_AT = [
  '2026-01-01T00:00:00.000Z',
  '2026-01-02T00:00:00.000Z',
  '2026-01-03T00:00:00.000Z',
  '2026-01-04T00:00:00.000Z',
];

let changed: CacheChangeListener | undefined;
let reads = 0;
let closeReader: (() => void) | undefined;

function notify(buckets: string[]) {
  const changes: HydrationSearchChanges = { searchChangedBuckets: buckets };
  changed?.(INITIAL_CACHE_REVISION, changes);
}

function dmHost(): CacheHost {
  return {
    ...createNoopCacheHost(),
    disabled: false,
    clientId: 'client-1',
    currentStorageGeneration: async () => GENERATION,
    readQuery: async () => ({ kind: 'hit', data: { user: { id: VIEWER } } }),
    search: async () => {
      reads++;
      return {
        documents: [
          {
            profile: 'quick-access-v1',
            recordKey: `GraphqlSoupChannel:${DM_ID}`,
            bucket: 'dm',
            searchText: 'peer',
            timestampMs: reads,
            sourceHash: `hash-${reads}`,
          },
        ],
        nextCursor: null,
      };
    },
    readRecordsByKeys: async ({ keys }) => ({
      revision: INITIAL_CACHE_REVISION,
      records: keys.map((recordKey) => ({
        recordKey,
        record: {
          __typename: 'GraphqlSoupChannel',
          name: 'Peer',
          channelType: 'direct_message',
          ownerId: VIEWER,
          participants: [{ userId: VIEWER }, { userId: PEER }],
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          viewedAt: VIEWED_AT[reads - 1],
          interactedAt: null,
        },
      })),
    }),
    onCacheChanged: (listener) => {
      changed = listener;
      return () => {
        changed = undefined;
      };
    },
  };
}

function mountSource(host: CacheHost) {
  let facts: Accessor<ReadonlyMap<string, PersonFacts> | undefined> = () =>
    undefined;
  const [account] = createSignal(currentQueryAccount());
  function Harness() {
    facts = createContactContextSource({
      account,
      host: () => host,
      generation: () => 0,
      enabled: () => true,
    });
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  ));
  return {
    viewedAt: () => {
      const stamp = facts()?.get(PEER)?.directMessage?.timestampMs;
      return stamp === undefined ? undefined : new Date(stamp).toISOString();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  reads = 0;
  queryClient.clear();
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: VIEWER,
    authenticated: true,
  });
  queryClient.setQueryData(channelKeys.listChannels(VIEWER).queryKey, [
    {
      id: DM_ID,
      name: null,
      channel_type: 'direct_message',
      updated_at: '2025-01-01T00:00:00.000Z',
      viewed_at: null,
      participants: [{ user_id: VIEWER }, { user_id: PEER }],
    } as unknown as ApiChannelWithLatest,
  ]);
  queryClient.setQueryData(channelKeys.activity(VIEWER).queryKey, []);
  queryClient.setQueryData(emailKeys.links(VIEWER).queryKey, { links: [] });
});
afterEach(() => {
  closeReader?.();
  closeReader = undefined;
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("leaves the previous account's cached inboxes alone when its account changes", async () => {
  const other = 'macro|other@example.com';
  queryClient.setQueryData(emailKeys.links(VIEWER).queryKey, {
    links: [
      {
        id: 'inbox',
        macro_id: VIEWER,
        email_address: 'viewer@example.com',
        is_primary: true,
      },
    ],
  });
  queryClient.setQueryData(emailKeys.links(other).queryKey, {
    links: [
      {
        id: 'inbox',
        macro_id: other,
        email_address: 'other@example.com',
        is_primary: true,
      },
    ],
  });
  queryClient.setQueryData(channelKeys.listChannels(other).queryKey, []);
  queryClient.setQueryData(channelKeys.activity(other).queryKey, []);
  const [account, setAccount] = createSignal(currentQueryAccount());
  function Harness() {
    createContactContextSource({
      account,
      host: () => undefined,
      generation: () => 0,
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
  expect(queryClient.getQueryData(emailKeys.links(VIEWER).queryKey)).toEqual({
    links: [
      {
        id: 'inbox',
        macro_id: VIEWER,
        email_address: 'viewer@example.com',
        is_primary: true,
      },
    ],
  });
});

it('rereads its DM overlay for DM changes only while a contact reader is open', async () => {
  const source = mountSource(dmHost());
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(1);
  expect(source.viewedAt()).toBe(VIEWED_AT[0]);

  notify(['dm']);
  notify(['channel']);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads).toBe(1);

  closeReader = openContactReader();
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(2);
  expect(source.viewedAt()).toBe(VIEWED_AT[1]);

  await vi.advanceTimersByTimeAsync(5_000);
  notify(['channel']);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads).toBe(2);

  notify(['dm']);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(3);
  expect(source.viewedAt()).toBe(VIEWED_AT[2]);

  closeReader();
  closeReader = undefined;
  await vi.advanceTimersByTimeAsync(5_000);
  notify(['dm']);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads).toBe(3);
});

it('does not reread on opening a reader when no DM changed meanwhile', async () => {
  mountSource(dmHost());
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(1);

  notify(['channel']);
  closeReader = openContactReader();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads).toBe(1);
});

it('catches up when a contact window opens in another tab', async () => {
  const fromOtherTab = (seq: number, open: boolean) =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'macro.contact-readers',
        newValue: JSON.stringify({ kind: 'readers', tab: 'tab-2', seq, open }),
      })
    );
  const source = mountSource(dmHost());
  await vi.advanceTimersByTimeAsync(0);
  notify(['dm']);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads).toBe(1);

  fromOtherTab(1, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(2);
  expect(source.viewedAt()).toBe(VIEWED_AT[1]);

  fromOtherTab(2, false);
  await vi.advanceTimersByTimeAsync(5_000);
  notify(['dm']);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(reads).toBe(2);
});
