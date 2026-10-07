import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { authKeys } from '@queries/auth/keys';
import { createGraphqlSoupDoneProjection } from '@queries/soup/graphql/done-projection';
import { usePendingGraphqlSoupDone } from '@queries/soup/graphql/optimistic-done';
import type { SoupAstItemsData } from '@queries/soup/items';
import { QueryClient } from '@tanstack/solid-query';
import { createMemo, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGraphqlDoneOperation,
  doneEntityKey,
} from './graphql-done-operation';
import { notificationReceipt } from './tests/done-write-fixture';

type DoneArgs = Parameters<
  typeof import('../utils').executeMarkEntitiesDone
>[0];
const writes = vi.hoisted(() => ({
  done: vi.fn<(args: DoneArgs) => Promise<string[]>>(),
  undone: vi.fn(),
  notificationOverride: vi.fn(() =>
    Object.assign(vi.fn(), { release: vi.fn() })
  ),
}));
vi.mock('../utils', () => ({
  executeMarkEntitiesDone: writes.done,
  executeMarkEntitiesUndone: writes.undone,
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(async () => {}),
}));
vi.mock('@notifications', () => ({
  setDoneOverride: writes.notificationOverride,
}));

let client: QueryClient;
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  writes.done.mockReset();
  writes.undone.mockReset();
  writes.notificationOverride.mockClear();
  client = new QueryClient();
  client.setQueryData(authKeys.userInfo.queryKey, {
    userId: 'viewer',
    authenticated: true,
  });
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  client.clear();
  vi.useRealTimers();
});

const document = (id: string) =>
  ({
    type: 'document',
    id,
    name: id,
    notifications: [
      { id: `n-${id}`, state: 'unseen', created_at: '2020-01-01T00:00:00Z' },
    ],
  }) as unknown as EntityData;

function setup(grouped: boolean, targets: string[]) {
  const source: SoupAstItemsData = {
    entities: [document('a'), document('b')],
    groups: grouped
      ? [
          {
            key: 'group',
            label: 'Group',
            displayOrder: 0,
            itemIds: ['a', 'b'],
            totalCount: 2,
            nextCursor: null,
          },
        ]
      : undefined,
  };
  const reply = Promise.withResolvers<UnifiedNotification[]>();
  writes.done.mockImplementationOnce(async (args) => {
    const rows = await reply.promise;
    args.onWriteSettled?.({
      kind: 'entity-notifications',
      result: { status: 'fulfilled', value: rows },
    });
    return rows.map(({ id }) => id);
  });
  return createRoot((dispose) => {
    const pending = usePendingGraphqlSoupDone();
    const project = createGraphqlSoupDoneProjection();
    const deleted = new Set<string>();
    const visible = createMemo(
      () => project('same-query', source, pending(), true, deleted)!
    );
    const entities = source.entities.filter(({ id }) => targets.includes(id));
    const operation = createGraphqlDoneOperation({
      entities,
      emailIds: [],
      notificationIds: [],
      notificationIdsByEntity: new Map(
        entities.map((entity) => [doneEntityKey(entity), [`n-${entity.id}`]])
      ),
      notificationEntities: entities.map(({ id }) => ({
        type: 'document',
        id,
      })),
      scopeChannelThreads: false,
    });
    cleanup.push(() => {
      operation.releaseGraphql();
      dispose();
    });
    return { operation, visible, pending, source, reply };
  });
}

describe('no-op receipts with real GraphQL display intents', () => {
  it.each([false, true])(
    'releases an unacknowledged hide without waiting for stale readers (grouped=%s)',
    async (grouped) => {
      const { operation, visible, pending, source, reply } = setup(grouped, [
        'a',
      ]);
      await vi.waitFor(() =>
        expect(visible().entities.map(({ id }) => id)).toEqual(['b'])
      );
      const write = operation.execute();
      reply.resolve([]);
      await write;
      operation.settle(); // Same success path that used to pin the unacknowledged hide.
      await vi.waitFor(() => expect(pending()).toEqual([]));
      expect(operation.hasAccepted()).toBe(false);
      expect(operation.completedCount()).toBe(0);
      expect(
        writes.notificationOverride.mock.results[0].value
      ).toHaveBeenCalledOnce();
      expect(visible()).toBe(source);
      await vi.advanceTimersByTimeAsync(120_001);
      expect(visible()).toBe(source);
      expect(writes.done).toHaveBeenCalledOnce();
      expect(writes.undone).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'releases only the no-op sibling while accepted intent awaits acknowledgement (grouped=%s)',
    async (grouped) => {
      const { operation, visible, pending, source, reply } = setup(grouped, [
        'a',
        'b',
      ]);
      await vi.waitFor(() => expect(visible().entities).toEqual([]));
      const write = operation.execute();
      reply.resolve([
        notificationReceipt('n-a', { type: 'document', id: 'a' }),
      ]);
      await write;
      operation.settle();
      await vi.waitFor(() =>
        expect(visible().entities.map(({ id }) => id)).toEqual(['b'])
      );
      expect(visible().entities[0]).toBe(source.entities[1]);
      expect(operation.completedCount()).toBe(1);
      expect(
        writes.notificationOverride.mock.results[0].value
      ).not.toHaveBeenCalled();
      expect(
        writes.notificationOverride.mock.results[1].value
      ).toHaveBeenCalledOnce();
      expect(pending()).toHaveLength(1);
      if (grouped)
        expect(visible().groups?.[0]).toMatchObject({
          itemIds: ['b'],
          totalCount: 1,
        });
      await vi.advanceTimersByTimeAsync(120_001);
      expect(visible().entities.map(({ id }) => id)).toEqual(['b']);
      expect(pending()).toHaveLength(1);
    }
  );
});
