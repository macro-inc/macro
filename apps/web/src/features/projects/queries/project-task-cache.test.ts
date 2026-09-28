import { buildTaskQuery } from '@app/features/tasks-view/queries/task-query';
import { soupKeys } from '@queries/soup/keys';
import { QueryClient } from '@tanstack/solid-query';
import { expect, it, vi } from 'vitest';
import { projectKeys } from './keys';
import {
  optimisticProjectTask,
  updateProjectTaskCache,
} from './project-task-cache';

const args = (taskIds: string[]) =>
  buildTaskQuery({
    tab: 'team-tasks',
    userId: 'viewer',
    facets: {},
    groupBy: 'none',
    sort: [],
    taskIds,
  });
it('inserts a normal task into the next membership query before any network response', async () => {
  const cache = new QueryClient();
  cache.setQueryData(projectKeys.detail('viewer', 'project').queryKey, {
    project: { taskIds: [] },
    properties: [],
  });
  cache.setQueryData(soupKeys.astItems(args([])).queryKey, {
    pages: [{ kind: 'flat', items: [], nextCursor: null }],
    pageParams: [null],
  });
  const task = optimisticProjectTask('temporary', 'viewer', [
    'New task',
    '',
    [],
    new Map(),
    vi.fn(),
  ]);
  await updateProjectTaskCache(
    cache,
    undefined,
    'viewer',
    'project',
    undefined,
    task
  );
  expect(
    cache.getQueryData(projectKeys.detail('viewer', 'project').queryKey)
  ).toMatchObject({ project: { taskIds: ['temporary'] } });
  expect(
    cache.getQueryData(soupKeys.astItems(args(['temporary'])).queryKey)
  ).toMatchObject({
    pages: [
      {
        kind: 'flat',
        items: [
          { tag: 'document', data: { id: 'temporary', name: 'New task' } },
        ],
      },
    ],
  });
});

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

it('replaces IDs without duplicating the task and rolls back only a failed concurrent insert', async () => {
  const cache = new QueryClient();
  cache.setQueryData(projectKeys.detail('viewer', 'project').queryKey, {
    project: { taskIds: [] },
    properties: [],
  });
  cache.setQueryData(soupKeys.astItems(args([])).queryKey, {
    pages: [{ kind: 'flat', items: [], nextCursor: null }],
    pageParams: [null],
  });
  const first = optimisticProjectTask('first', 'viewer', [
    'First',
    '',
    [],
    new Map(),
    vi.fn(),
  ]);
  const second = optimisticProjectTask('second', 'viewer', [
    'Second',
    '',
    [],
    new Map(),
    vi.fn(),
  ]);
  await updateProjectTaskCache(
    cache,
    undefined,
    'viewer',
    'project',
    undefined,
    first
  );
  await updateProjectTaskCache(
    cache,
    undefined,
    'viewer',
    'project',
    undefined,
    second
  );
  await updateProjectTaskCache(cache, undefined, 'viewer', 'project', 'first', {
    ...first,
    id: 'saved',
  });
  await updateProjectTaskCache(cache, undefined, 'viewer', 'project', 'second');
  expect(
    cache.getQueryData(projectKeys.detail('viewer', 'project').queryKey)
  ).toMatchObject({ project: { taskIds: ['saved'] } });
  expect(
    cache.getQueryData(soupKeys.astItems(args(['saved'])).queryKey)
  ).toMatchObject({
    pages: [{ items: [{ data: { id: 'saved', name: 'First' } }] }],
  });
  expect(
    (
      cache.getQueryData(soupKeys.astItems(args(['saved'])).queryKey) as {
        pages: { items: unknown[] }[];
      }
    ).pages[0].items
  ).toHaveLength(1);
});

import type {
  CacheHost,
  CacheReadArgs,
  CacheWriteArgs,
} from '@graphql-cache/host/types';
import {
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
} from '@queries/soup/graphql/ast';
import type {
  GroupSoupQuery,
  SoupQuery,
} from '@service-storage/graphql/generated/graphql';
import { hashKey } from '@tanstack/solid-query';

it.each(['none', 'status'] as const)(
  'writes %s GraphQL query data with REST disabled, preserving grouping and rollback',
  async (groupBy) => {
    const cache = new QueryClient();
    const queryArgs = (ids: string[]) => ({
      ...args(ids),
      groupBy:
        groupBy === 'status'
          ? { type: 'property' as const, propertyDefinitionId: 'status' }
          : undefined,
    });
    const input = (ids: string[]) =>
      groupBy === 'status'
        ? makeGraphqlGroupedSoupInput({
            ...queryArgs(ids),
            groupBy: queryArgs(ids).groupBy!,
          })
        : makeGraphqlSoupInput(queryArgs(ids));
    // GraphQL views still register the disabled REST observer, but have no REST data.
    cache
      .getQueryCache()
      .build(cache, { queryKey: soupKeys.astItems(queryArgs([])).queryKey });
    cache.setQueryData(projectKeys.detail('viewer', 'project').queryKey, {
      project: { taskIds: [] },
      properties: [],
    });
    const data = new Map<string, unknown>();
    data.set(
      hashKey([input([])]),
      groupBy === 'status'
        ? { user: { id: 'viewer', groupSoup: { bins: [] } } }
        : {
            user: {
              id: 'viewer',
              soup: { items: [], nextCursor: null },
              emailLinks: [],
            },
          }
    );
    const host: Pick<CacheHost, 'readQuery' | 'writeQuery'> = {
      readQuery: vi.fn(async ({ variables }: CacheReadArgs) =>
        data.has(hashKey([variables?.input]))
          ? {
              kind: 'hit' as const,
              data: data.get(hashKey([variables?.input])),
            }
          : { kind: 'miss' as const }
      ),
      writeQuery: vi.fn(async ({ variables, data: next }: CacheWriteArgs) => {
        data.set(hashKey([variables?.input]), next);
        return {
          revision: 'test' as import('@graphql-cache/protocol').CacheRevision,
          revisionAdvanced: true,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      }),
    };
    const task = optimisticProjectTask('temporary', 'viewer', [
      'GraphQL task',
      '',
      [],
      new Map(),
      vi.fn(),
    ]);
    await updateProjectTaskCache(
      cache,
      host,
      'viewer',
      'project',
      undefined,
      task
    );
    const inserted = data.get(
      hashKey([input(['temporary'])])
    ) as GroupSoupQuery & SoupQuery;
    const items =
      groupBy === 'status'
        ? inserted.user.groupSoup.bins[0].items
        : inserted.user.soup.items;
    expect(items).toEqual([task]);
    if (groupBy === 'status')
      expect(inserted.user.groupSoup.bins[0].totalCount).toBe(1);
    // Mirrors the observer switching to its seeded key.
    cache.getQueryCache().build(cache, {
      queryKey: soupKeys.astItems(queryArgs(['temporary'])).queryKey,
    });
    await updateProjectTaskCache(cache, host, 'viewer', 'project', 'temporary');
    const rolledBack = data.get(hashKey([input([])])) as GroupSoupQuery &
      SoupQuery;
    expect(
      groupBy === 'status'
        ? rolledBack.user.groupSoup.bins.flatMap((bin) => bin.items)
        : rolledBack.user.soup.items
    ).toEqual([]);
  }
);

it.each(['status', 'assignee', 'date'] as const)(
  'creates a normal %s group in a cold REST query',
  async (groupBy) => {
    const cache = new QueryClient();
    const queryArgs = (taskIds: string[]) =>
      buildTaskQuery({
        tab: 'team-tasks',
        userId: 'viewer',
        facets: {},
        sort: [],
        groupBy,
        taskIds,
      });
    cache.setQueryData(projectKeys.detail('viewer', 'project').queryKey, {
      project: { taskIds: [] },
      properties: [],
    });
    cache
      .getQueryCache()
      .build(cache, { queryKey: soupKeys.astItems(queryArgs([])).queryKey });
    const task = optimisticProjectTask('temporary', 'viewer', [
      'New task',
      '',
      [],
      new Map(),
      vi.fn(),
    ]);
    await updateProjectTaskCache(
      cache,
      undefined,
      'viewer',
      'project',
      undefined,
      task
    );
    expect(
      cache.getQueryData(soupKeys.astItems(queryArgs(['temporary'])).queryKey)
    ).toMatchObject({
      pages: [
        {
          kind: 'grouped',
          groups: [{ totalCount: 1, itemIds: ['temporary'] }],
          items: { temporary: { tag: 'document', data: { id: 'temporary' } } },
        },
      ],
    });
  }
);

it('does not put an optimistic task into a query excluded by its active filters', async () => {
  const cache = new QueryClient();
  cache.setQueryData(projectKeys.detail('viewer', 'project').queryKey, {
    project: { taskIds: [] },
    properties: [],
  });
  cache.getQueryCache().build(cache, {
    queryKey: soupKeys.astItems(args([])).queryKey,
    meta: { insertFilter: () => false },
  });
  const task = optimisticProjectTask('temporary', 'viewer', [
    'Filtered task',
    '',
    [],
    new Map(),
    vi.fn(),
  ]);
  await updateProjectTaskCache(
    cache,
    undefined,
    'viewer',
    'project',
    undefined,
    task
  );
  expect(
    cache.getQueryData(soupKeys.astItems(args(['temporary'])).queryKey)
  ).toMatchObject({ pages: [{ kind: 'flat', items: [] }] });
});
