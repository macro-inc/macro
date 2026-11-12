import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { PeopleContextUpdate } from '@graphql-cache/people/generated';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { batch, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authKeys } from '../auth/keys';
import { channelKeys } from '../channel/keys';
import { emailKeys } from '../email/keys';
import { useContactContextPublisher } from './use-context-publisher';

let client: QueryClient;
const [viewer, setViewer] = createSignal('macro|one@example.com');
vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => viewer,
  useIsAuthenticated: () => () => true,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getChannels: () => new Promise(() => {}),
    getActivity: () => new Promise(() => {}),
  },
}));
vi.mock('@service-email/client', () => ({
  emailClient: { getLinks: () => new Promise(() => {}) },
}));

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  setViewer('macro|one@example.com');
  client.setQueryData(authKeys.userInfo.queryKey, {
    id: viewer(),
    authenticated: true,
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});

it('waits for all owned inputs, shares the supplied leader, publishes deltas and resets on generation changes', async () => {
  let storageGeneration = '00000000-0000-4000-8000-000000000001';
  const writes: PeopleContextUpdate[] = [];
  let revision = 0;
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () => storageGeneration,
    people: {
      readSql: async () => ({ kind: 'unsupported' as const }),
      resolveReferences: async () => ({ kind: 'unsupported' as const }),
      ...unsupportedContactSync,
      context: vi.fn(async () => ({ kind: 'missing' as const })),
      update: vi.fn(async (update: PeopleContextUpdate) => {
        writes.push(update);
        return parseCacheRevision(String(++revision));
      }),
      search: vi.fn(async () => ({ kind: 'contextPending' as const })),
    },
  };
  const [leader, setLeader] = createSignal(false);
  const [generation, setGeneration] = createSignal(0);
  function Runner() {
    const state = useContactContextPublisher(
      () => (leader() ? host : undefined),
      generation
    );
    return <output>{state()}</output>;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Runner />
    </QueryClientProvider>
  ));
  client.setQueryData(channelKeys.listChannels(viewer()).queryKey, []);
  client.setQueryData(channelKeys.activity(viewer()).queryKey, []);
  await vi.advanceTimersByTimeAsync(250);
  expect(writes).toHaveLength(0);
  setLeader(true);
  await vi.advanceTimersByTimeAsync(250);
  expect(writes).toHaveLength(0); // missing links are not an empty authoritative list
  client.setQueryData(emailKeys.links(viewer()).queryKey, {
    links: [{ email_address: 'second@example.com', is_primary: false }],
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(view.container.textContent).toBe('ready');
  expect(writes.map((write) => write.action.kind)).toEqual([
    'begin',
    'patch',
    'commit',
  ]);
  expect(writes[1].action).toEqual({
    kind: 'patch',
    updates: [
      {
        userId: 'macro|second@example.com',
        facts: {
          lastInteractionMs: null,
          directMessage: null,
          secondaryInbox: true,
        },
      },
    ],
  });
  client.setQueryData(emailKeys.links(viewer()).queryKey, { links: [] });
  await vi.advanceTimersByTimeAsync(250);
  expect(writes.at(-1)?.action).toEqual({
    kind: 'patch',
    updates: [
      {
        userId: 'macro|second@example.com',
        facts: {
          lastInteractionMs: null,
          directMessage: null,
          secondaryInbox: false,
        },
      },
    ],
  });
  storageGeneration = '00000000-0000-4000-8000-000000000002';
  setGeneration(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(writes.at(-1)?.scope.storageGeneration).toBe(storageGeneration);
  const committed = writes.length;
  setLeader(false);
  client.setQueryData(emailKeys.links(viewer()).queryKey, {
    links: [{ email_address: 'other@example.com', is_primary: false }],
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(writes).toHaveLength(committed);
});

it('cannot relabel retained old-account rows and stops late work after ownership changes', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writes: PeopleContextUpdate[] = [];
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    people: {
      readSql: async () => ({ kind: 'unsupported' as const }),
      resolveReferences: async () => ({ kind: 'unsupported' as const }),
      ...unsupportedContactSync,
      context: async () => ({ kind: 'missing' as const }),
      update: async (update: PeopleContextUpdate) => {
        writes.push(update);
        entered.resolve();
        await release.promise;
        return parseCacheRevision('1');
      },
      search: async () => ({ kind: 'contextPending' as const }),
    },
  };
  client.setQueryData(channelKeys.listChannels(viewer()).queryKey, []);
  client.setQueryData(channelKeys.activity(viewer()).queryKey, []);
  client.setQueryData(emailKeys.links(viewer()).queryKey, {
    links: [{ email_address: 'private@example.com', is_primary: false }],
  });
  function Runner() {
    useContactContextPublisher(
      () => host,
      () => 0
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Runner />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(250);
  await entered.promise;
  batch(() => {
    client.setQueryData(authKeys.userInfo.queryKey, {
      id: 'macro|two@example.com',
      authenticated: true,
    });
    setViewer('macro|two@example.com');
  });
  release.resolve();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(writes.map((write) => write.action.kind)).toEqual(['begin']);
  expect(writes[0].scope.identity).toBe('macro|one@example.com');
});

it('releases its source and stays unsupported without retrying or writing', async () => {
  client.setQueryData(channelKeys.listChannels(viewer()).queryKey, []);
  client.setQueryData(channelKeys.activity(viewer()).queryKey, []);
  client.setQueryData(emailKeys.links(viewer()).queryKey, { links: [] });
  const context = vi.fn(async () => ({ kind: 'unsupported' as const }));
  const update = vi.fn(async () => parseCacheRevision('1'));
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    people: {
      ...unsupportedContactSync,
      readSql: async () => ({ kind: 'unsupported' as const }),
      resolveReferences: async () => ({ kind: 'unsupported' as const }),
      context,
      update,
      search: async () => ({ kind: 'contextPending' as const }),
    },
  };
  function Runner() {
    const state = useContactContextPublisher(
      () => host,
      () => 0
    );
    return <output>{state()}</output>;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Runner />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(context).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
  expect(view.container.textContent).toBe('unsupported');
});

it('backs off transient failures with at most three automatic retries', async () => {
  client.setQueryData(channelKeys.listChannels(viewer()).queryKey, []);
  client.setQueryData(channelKeys.activity(viewer()).queryKey, []);
  client.setQueryData(emailKeys.links(viewer()).queryKey, { links: [] });
  const context = vi.fn(async () => ({ kind: 'missing' as const }));
  const update = vi.fn(async () => {
    throw new Error('write failed');
  });
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    currentStorageGeneration: async () =>
      '00000000-0000-4000-8000-000000000001',
    people: {
      ...unsupportedContactSync,
      readSql: async () => ({ kind: 'unsupported' as const }),
      resolveReferences: async () => ({ kind: 'unsupported' as const }),
      context,
      update,
      search: async () => ({ kind: 'contextPending' as const }),
    },
  };
  function Runner() {
    const state = useContactContextPublisher(
      () => host,
      () => 0
    );
    return <output>{state()}</output>;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Runner />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(context).toHaveBeenCalledTimes(4);
  expect(view.container.textContent).toBe('error');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(context).toHaveBeenCalledTimes(4);
});
