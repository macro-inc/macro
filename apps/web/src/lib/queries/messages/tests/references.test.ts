import type { ReferencedThread } from '@service-storage/generated/schemas/referencedThread';
import type { MessageParent } from '@service-storage/messages';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChannelReferenceThreadsQuery } from '../references';

const mocks = vi.hoisted(() => ({
  references: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  updates: new Set<(frame: unknown) => void>(),
  reconnects: new Set<() => void>(),
}));
vi.mock('@service-connection/websocket', async () => {
  const { onCleanup } = await import('solid-js');
  return {
    ws: {},
    createConnectionWebsocketEffect: (callback: (frame: unknown) => void) => {
      mocks.updates.add(callback);
      onCleanup(() => mocks.updates.delete(callback));
    },
  };
});
vi.mock('@macro-inc/collaboration/websocket', async () => {
  const { onCleanup } = await import('solid-js');
  return {
    createReconnectEffect: (_ws: unknown, callback: () => void) => {
      mocks.reconnects.add(callback);
      onCleanup(() => mocks.reconnects.delete(callback));
    },
  };
});
vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: { references: mocks.references },
}));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: (options: () => unknown) => options(),
}));
vi.mock('../../client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));

type QueryOptions = {
  queryKey: unknown[];
  enabled: boolean;
  refetchInterval: number | false;
  queryFn: () => Promise<ReferencedThread[]>;
};

const document: MessageParent = { type: 'document', id: 'doc' };
const disposers: (() => void)[] = [];
function mount(enabled: boolean) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    return useChannelReferenceThreadsQuery(
      () => document,
      () => enabled
    ) as unknown as QueryOptions;
  });
}
function emit(frame: unknown) {
  for (const listener of mocks.updates) listener(frame);
}
function messageUpdate(change: string, parentType = 'channel') {
  return {
    type: 'message_update',
    data: JSON.stringify({
      parent: { type: parentType, id: 'source' },
      change: { type: change },
    }),
  };
}
function source(root: string, channel = 'launch'): ReferencedThread {
  return {
    parent: { type: 'channel', id: channel },
    root_id: root,
    channel_name: 'Launch',
    can_reply: true,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

it('reads every page of authorized source identities under the document key', async () => {
  const cursor = { created_at: '2026-09-09T00:00:00Z', id: 'root-a' };
  mocks.references
    .mockResolvedValueOnce({ threads: [source('root-a')], next_cursor: cursor })
    .mockResolvedValueOnce({ threads: [source('root-b')], next_cursor: null });
  const options = mount(true);
  expect(options.queryKey).toEqual(['messages', 'references', document]);
  expect(options.enabled).toBe(true);
  expect(options.refetchInterval).toBe(30_000);
  await expect(options.queryFn()).resolves.toEqual([
    source('root-a'),
    source('root-b'),
  ]);
  expect(mocks.references.mock.calls).toEqual([
    [document, undefined],
    [document, cursor],
  ]);
});

it('refreshes discovery only for source changes that can add or remove a thread', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mount(true);
  emit(messageUpdate('typing'));
  emit(messageUpdate('reaction_changed'));
  emit(messageUpdate('posted', 'document'));
  emit({ type: 'contacts_invalidation' });
  emit({ type: 'message_update', data: '{not json' });
  expect(mocks.invalidate).not.toHaveBeenCalled();
  for (const change of [
    'posted',
    'edited',
    'message_deleted',
    'thread_updated',
  ])
    emit(messageUpdate(change));
  expect(mocks.invalidate).toHaveBeenCalledTimes(4);
  for (const reconnect of mocks.reconnects) reconnect();
  expect(mocks.invalidate).toHaveBeenCalledTimes(5);
  expect(mocks.invalidate).toHaveBeenLastCalledWith({
    queryKey: ['messages', 'references', document],
  });
});

it('stays idle while channel mentions are hidden', () => {
  const options = mount(false);
  expect(options.enabled).toBe(false);
  expect(options.refetchInterval).toBe(false);
  emit(messageUpdate('posted'));
  for (const reconnect of mocks.reconnects) reconnect();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  expect(mocks.references).not.toHaveBeenCalled();
});
