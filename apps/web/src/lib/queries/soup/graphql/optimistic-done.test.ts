import type { EntityData } from '@entity/types/entity';
import { QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));

import {
  GRAPHQL_SOUP_DONE_RETENTION_MS,
  hideGraphqlSoupEntitiesAsDone,
  type PendingGraphqlSoupDone,
  usePendingGraphqlSoupDone,
  withPendingDoneIds,
} from './optimistic-done';

let client: QueryClient;
let dispose: (() => void) | undefined;
beforeEach(() => {
  client = new QueryClient();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  client.clear();
  vi.useRealTimers();
});

const STARTED_AT = Date.parse('2026-10-01T12:00:00Z');
const AFTER_ACTION = new Date(STARTED_AT + 1_000).toISOString();

const entity = (
  id: string,
  notifications: { id: string; state: string; created_at?: string }[] = []
): EntityData =>
  ({
    id,
    type: 'email',
    notifications: notifications.map((notification) => ({
      created_at: new Date(STARTED_AT - 1_000).toISOString(),
      ...notification,
    })),
  }) as unknown as EntityData;

const pending = (
  entityIds: string[],
  notificationIds: string[] = []
): PendingGraphqlSoupDone => ({
  entityIds: new Set(entityIds),
  notificationIds: new Set(notificationIds),
  startedAt: STARTED_AT,
  scopeChannelThreads: false,
});

function observePending() {
  let read!: ReturnType<typeof usePendingGraphqlSoupDone>;
  dispose = createRoot((disposeRoot) => {
    read = usePendingGraphqlSoupDone();
    return disposeRoot;
  });
  return read;
}

describe('withPendingDoneIds', () => {
  it('returns the input set when nothing is pending', () => {
    const deleted = new Set(['x']);
    expect(withPendingDoneIds(deleted, [entity('a')], [])).toBe(deleted);
  });

  it('hides marked entities alongside pending deletions', () => {
    const hidden = withPendingDoneIds(
      new Set(['x']),
      [entity('a', [{ id: 'n1', state: 'unseen' }]), entity('b')],
      [pending(['a'], ['n1'])]
    );
    expect([...hidden].sort()).toEqual(['a', 'x']);
  });

  it('re-admits an entity with an active notification newer than the action', () => {
    const hidden = withPendingDoneIds(
      new Set(),
      [
        entity('a', [
          { id: 'n1', state: 'unseen' },
          { id: 'n2', state: 'unseen', created_at: AFTER_ACTION },
        ]),
      ],
      [pending(['a'], ['n1'])]
    );
    expect(hidden.has('a')).toBe(false);
  });

  it('lets the latest Done win after fresh activity re-admitted the row', () => {
    const row = entity('a', [
      { id: 'n1', state: 'done' },
      { id: 'n2', state: 'unseen', created_at: AFTER_ACTION },
    ]);
    const first = pending(['a'], ['n1']);
    const second = pending(['a'], ['n1', 'n2']);
    expect(withPendingDoneIds(new Set(), [row], [first]).has('a')).toBe(false);
    expect(withPendingDoneIds(new Set(), [row], [first, second]).has('a')).toBe(
      true
    );
    // Releasing the second action restores the earlier decision, not a global clear.
    expect(withPendingDoneIds(new Set(), [row], [first]).has('a')).toBe(false);
  });

  it.each([new Date(STARTED_AT - 1).toISOString(), 'invalid', undefined])(
    'does not mistake a previously unloaded notification for new activity (%s)',
    (created_at) => {
      const row = entity('a', [
        { id: 'unloaded', state: 'unseen', created_at },
      ]);
      expect(
        withPendingDoneIds(new Set(), [row], [pending(['a'])]).has('a')
      ).toBe(true);
    }
  );

  it('does not let a separate thread re-admit a scoped channel row', () => {
    const row = {
      id: 'a',
      type: 'channel',
      notifications: [
        {
          id: 'thread-notification',
          state: 'unseen',
          created_at: AFTER_ACTION,
          notification_metadata: {
            tag: 'channel_message_reply',
            content: { messageId: 'reply', threadId: 'root' },
          },
        },
      ],
    } as unknown as EntityData;
    expect(
      withPendingDoneIds(new Set(), [row], [pending(['a'])]).has('a')
    ).toBe(false);
    const scoped = { ...pending(['a']), scopeChannelThreads: true };
    expect(withPendingDoneIds(new Set(), [row], [scoped]).has('a')).toBe(true);
  });

  it('keeps hiding once the marked notifications are done', () => {
    const hidden = withPendingDoneIds(
      new Set(),
      [entity('a', [{ id: 'n1', state: 'done' }])],
      [pending(['a'], ['n1'])]
    );
    expect(hidden.has('a')).toBe(true);
  });
});

describe('hideGraphqlSoupEntitiesAsDone', () => {
  it('publishes an overlay until it is released', async () => {
    const read = observePending();
    const overlay = hideGraphqlSoupEntitiesAsDone({
      entityIds: ['a'],
      notificationIds: ['n1'],
    });
    await vi.waitFor(() =>
      expect(read().map(({ entityIds }) => [...entityIds])).toEqual([['a']])
    );

    overlay.release();
    overlay.release();
    await vi.waitFor(() => expect(read()).toEqual([]));
  });

  it('expires overlays that are never released', async () => {
    vi.useFakeTimers();
    const read = observePending();
    hideGraphqlSoupEntitiesAsDone({ entityIds: ['a'], notificationIds: [] });
    hideGraphqlSoupEntitiesAsDone({ entityIds: ['b'], notificationIds: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(read()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DONE_RETENTION_MS);
    expect(read()).toEqual([]);
  });
});
