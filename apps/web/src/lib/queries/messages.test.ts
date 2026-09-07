import {
  useEntitySubscription,
  useReopenTrackedEntitiesOnReconnect,
} from '@service-connection/client';
import type { MessageParent } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useMessageThreadQuery } from './messages';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  clearStream: vi.fn(),
  focused: vi.fn(() => true),
  invalidate: vi.fn().mockResolvedValue(undefined),
  updates: new Set<(event: unknown) => void>(),
  reconnects: new Set<() => void>(),
}));
vi.mock('@core/signal/tabFocus', () => ({ isTabFocused: mocks.focused }));
vi.mock('@service-connection/stream', () => ({
  clearStream: mocks.clearStream,
}));
vi.mock('@service-connection/websocket', async () => {
  const { onCleanup } = await import('solid-js');
  return {
    ws: { send: mocks.send },
    createConnectionWebsocketEffect: (callback: (event: unknown) => void) => {
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
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: (options: () => unknown) => options(),
}));
vi.mock('./client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));

const parent: MessageParent = { type: 'document', id: 'source-document' };
const disposers: (() => void)[] = [];
function mount(view: () => void) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    view();
    return dispose;
  });
}
function mountBlock() {
  return mount(() =>
    useEntitySubscription(() => ({
      entity_type: parent.type,
      entity_id: parent.id,
    }))
  );
}
function sent(action: string, id = parent.id) {
  return mocks.send.mock.calls.filter(
    ([message]) => message.action === action && message.entity_id === id
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.focused.mockReturnValue(true);
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

it('subscribes and heartbeats a linked document drawer without a document block', () => {
  const close = mount(() =>
    useMessageThreadQuery(
      () => parent,
      () => 'root'
    )
  );
  expect(sent('open')).toHaveLength(1);
  vi.advanceTimersByTime(20_000);
  expect(sent('ping')).toHaveLength(1);
  for (const type of ['posted', 'edited', 'updated']) {
    for (const listener of mocks.updates) {
      listener({
        type: 'message_update',
        data: { parent, root_id: 'root', change: { type } },
      });
    }
  }
  expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  expect(mocks.invalidate).toHaveBeenLastCalledWith({
    queryKey: ['entity-messages', 'document', parent.id, 'thread', 'root'],
  });
  close();
  expect(sent('close')).toHaveLength(1);
  vi.advanceTimersByTime(20_000);
  expect(sent('ping')).toHaveLength(1);
  expect(mocks.updates.size).toBe(0);
});

it.each(['drawer', 'block'] as const)(
  'keeps the source subscription alive when the %s closes first',
  (first) => {
    const closeBlock = mountBlock();
    const closeDrawer = mount(() =>
      useMessageThreadQuery(
        () => parent,
        () => 'root'
      )
    );
    expect(sent('open')).toHaveLength(1);
    const closeFirst = first === 'drawer' ? closeDrawer : closeBlock;
    const closeLast = first === 'drawer' ? closeBlock : closeDrawer;
    closeFirst();
    expect(sent('close')).toHaveLength(0);
    expect(mocks.clearStream).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(sent('ping')).toHaveLength(1);
    closeLast();
    expect(sent('close')).toHaveLength(1);
    expect(mocks.clearStream).toHaveBeenCalledWith(parent.id);
  }
);

it('moves the drawer subscription with its source and reopens all remaining owners on reconnect', () => {
  mountBlock();
  const [source, setSource] = createSignal(parent);
  mount(() => {
    useReopenTrackedEntitiesOnReconnect();
    useMessageThreadQuery(source, () => 'root');
  });
  // Refetched session metadata may replace the parent object without changing it.
  setSource({ ...parent });
  expect(sent('open')).toHaveLength(1);
  expect(sent('close')).toHaveLength(0);
  setSource({ type: 'document', id: 'next-document' });
  expect(sent('close')).toHaveLength(0);
  expect(sent('open', 'next-document')).toHaveLength(1);
  for (const reconnect of mocks.reconnects) reconnect();
  expect(sent('open')).toHaveLength(2);
  expect(sent('open', 'next-document')).toHaveLength(2);
  expect(mocks.invalidate).toHaveBeenLastCalledWith({
    queryKey: [
      'entity-messages',
      'document',
      'next-document',
      'thread',
      'root',
    ],
  });
});
