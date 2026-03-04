import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHANNEL_DRAFT_DB_VERSION,
  createDraftKey,
  createDraftManager,
  createDraftPersistenceKey,
  type DraftEvent,
  type DraftPersistence,
  type DraftRecord,
  type DraftScope,
  type DraftSyncChannel,
  type DraftSyncMessage,
} from '../draft-manager';

type DraftValue = {
  value: string;
};

function createMemoryPersistence<T>() {
  const records = new Map<string, DraftRecord<T>>();

  const persistence: DraftPersistence<T> = {
    get: async (id) => records.get(id),
    put: async (record) => {
      records.set(record.id, record);
    },
    delete: async (id) => {
      records.delete(id);
    },
  };

  return {
    records,
    persistence,
  };
}

function createSyncChannelNetwork() {
  const subscribers = new Set<(message: DraftSyncMessage) => void>();

  const createChannel = (): DraftSyncChannel => {
    const localSubscribers = new Set<(message: DraftSyncMessage) => void>();

    return {
      postMessage: (message) => {
        subscribers.forEach((subscriber) => {
          subscriber(message);
        });
      },
      onMessage: (listener) => {
        const subscriber = (message: DraftSyncMessage) => listener(message);
        subscribers.add(subscriber);
        localSubscribers.add(subscriber);

        return () => {
          subscribers.delete(subscriber);
          localSubscribers.delete(subscriber);
        };
      },
      close: () => {
        localSubscribers.forEach((subscriber) => {
          subscribers.delete(subscriber);
        });
        localSubscribers.clear();
      },
    };
  };

  return { createChannel };
}

function createScope(
  scope: DraftScope = { type: 'channel-input' },
  input?: {
    persistence?: DraftPersistence<DraftValue>;
    syncChannel?: DraftSyncChannel;
    debounceMs?: number;
    ttlMs?: number;
    maxWaitMs?: number;
  }
) {
  const manager = createDraftManager<DraftValue>({
    userId: 'user-1',
    channelId: 'channel-1',
    debounceMs: input?.debounceMs ?? 200,
    ttlMs: input?.ttlMs ?? 1_000,
    maxWaitMs: input?.maxWaitMs,
    persistence: input?.persistence,
    syncChannel: input?.syncChannel,
    isEmpty: (value) => value.value.trim() === '',
  });

  return {
    manager,
    scope: manager.forScope(scope),
  };
}

describe('createDraftManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates stable keys from discriminated scope values', () => {
    expect(createDraftKey('u1', 'c1', { type: 'channel-input' })).toBe(
      'u1:c1:channel-input'
    );
    expect(
      createDraftKey('u1', 'c1', { type: 'thread-reply', threadId: 't-1' })
    ).toBe('u1:c1:thread-reply:t-1');
    expect(
      createDraftKey('u1', 'c1', { type: 'message-edit', messageId: 'm-1' })
    ).toBe('u1:c1:message-edit:m-1');
  });

  it('builds a versioned persistence database name', () => {
    expect(createDraftPersistenceKey('channel-drafts', 1)).toBe(
      'channel-drafts-persist-v1'
    );
    expect(CHANNEL_DRAFT_DB_VERSION).toBe(1);
  });

  it('debounces writes and persists the latest value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T14:00:00.000Z'));

    const memory = createMemoryPersistence<DraftValue>();
    const { manager, scope } = createScope({ type: 'channel-input' }, {
      persistence: memory.persistence,
      debounceMs: 200,
    });

    scope.save({ value: 'first' });
    scope.save({ value: 'second' });

    expect(await scope.load()).toEqual({ value: 'second' });
    expect(memory.records.size).toBe(0);

    await vi.advanceTimersByTimeAsync(199);
    expect(memory.records.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(memory.records.size).toBe(1);
    expect(await scope.load()).toEqual({ value: 'second' });

    await manager.dispose();
  });

  it('flushes when maxWaitMs is exceeded during continuous saves', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T14:00:00.000Z'));

    const memory = createMemoryPersistence<DraftValue>();
    const { manager, scope } = createScope({ type: 'channel-input' }, {
      persistence: memory.persistence,
      debounceMs: 1_000,
      maxWaitMs: 250,
    });

    const id = createDraftKey('user-1', 'channel-1', { type: 'channel-input' });

    scope.save({ value: 'a' });
    await vi.advanceTimersByTimeAsync(100);
    scope.save({ value: 'b' });
    await vi.advanceTimersByTimeAsync(100);
    scope.save({ value: 'c' });
    await vi.advanceTimersByTimeAsync(100);
    scope.save({ value: 'd' });

    await Promise.resolve();

    expect(memory.records.get(id)?.value).toEqual({ value: 'd' });

    await manager.dispose();
  });

  it('removes expired drafts on load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T14:00:00.000Z'));

    const memory = createMemoryPersistence<DraftValue>();
    const { manager, scope } = createScope({ type: 'channel-input' }, {
      persistence: memory.persistence,
      ttlMs: 500,
    });

    scope.save({ value: 'expires' });
    await scope.flush();
    expect(await scope.load()).toEqual({ value: 'expires' });

    vi.setSystemTime(new Date('2026-03-04T14:00:00.501Z'));
    expect(await scope.load()).toBeNull();
    expect(memory.records.size).toBe(0);

    await manager.dispose();
  });

  it('clears persisted drafts', async () => {
    const memory = createMemoryPersistence<DraftValue>();
    const { manager, scope } = createScope({ type: 'thread-reply', threadId: 't-2' }, {
      persistence: memory.persistence,
    });

    scope.save({ value: 'reply draft' });
    await scope.flush();
    expect(await scope.load()).toEqual({ value: 'reply draft' });

    await scope.clear();
    expect(await scope.load()).toBeNull();
    expect(memory.records.size).toBe(0);

    await manager.dispose();
  });

  it('notifies remote subscribers through sync messages', async () => {
    const memory = createMemoryPersistence<DraftValue>();
    const network = createSyncChannelNetwork();

    const first = createScope({ type: 'thread-reply', threadId: 't-3' }, {
      persistence: memory.persistence,
      syncChannel: network.createChannel(),
    });
    const second = createScope({ type: 'thread-reply', threadId: 't-3' }, {
      persistence: memory.persistence,
      syncChannel: network.createChannel(),
    });

    const events: DraftEvent<DraftValue>[] = [];
    const unsubscribe = second.scope.subscribe((event) => {
      events.push(event);
    });

    first.scope.save({ value: 'from first tab' });
    await first.scope.flush();
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'updated',
      value: { value: 'from first tab' },
      source: 'remote',
    });

    unsubscribe();
    await first.manager.dispose();
    await second.manager.dispose();
  });
});
