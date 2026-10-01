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

const entity = (
  id: string,
  notifications: { id: string; state: string }[] = []
): EntityData =>
  ({ id, type: 'email', notifications }) as unknown as EntityData;

const pending = (
  entityIds: string[],
  notificationIds: string[] = []
): PendingGraphqlSoupDone => ({
  entityIds: new Set(entityIds),
  notificationIds: new Set(notificationIds),
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
          { id: 'n2', state: 'unseen' },
        ]),
      ],
      [pending(['a'], ['n1'])]
    );
    expect(hidden.has('a')).toBe(false);
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
