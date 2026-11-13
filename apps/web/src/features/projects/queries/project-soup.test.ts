import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { parseCacheRevision } from '@graphql-cache/protocol';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import {
  CombinedError,
  cacheExchange,
  createClient,
  type Exchange,
  type Operation,
} from '@urql/core';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromPromise, mergeMap, pipe } from 'wonka';

vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlProperties: () => [],
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: () => () => {},
}));
vi.mock('@entity/extractors-property/property-helpers', () => ({
  soupPropertyToProperty: vi.fn(),
}));

import type { ProjectSoupQuery } from '@service-storage/graphql/generated/graphql';
import type { ProjectFilters } from '../core/project';
import {
  createProjectSoupSource,
  projectSoupInput,
  projectSoupRows,
} from './project-soup';

const initiative = (id: string) => ({
  __typename: 'GraphqlSoupInitiative' as const,
  id,
  displayName: id,
  metadata: {
    ownerId: 'owner',
    updatedAt: '2026-09-27',
    createdAt: '2026-09-26',
    viewedAt: null,
  },
  viewerPermission: {
    __typename: 'GraphqlAccessLevelPermission' as const,
    accessLevel: 'EDIT' as const,
  },
  properties: [],
  taskCount: 8,
  completedTaskCount: 3,
  notifications: [],
  cacheProjection: null,
  frecencyScore: null,
  isFavorited: false,
});
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('project Soup source', () => {
  it('reuses cached projects on remount while refreshing in the background', async () => {
    const refresh = Promise.withResolvers<void>();
    let networkReads = 0;
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        mergeMap((operation) =>
          fromPromise(
            (async () => {
              if (operation.kind === 'query' && ++networkReads > 1)
                await refresh.promise;
              return {
                operation,
                data: {
                  user: {
                    id: 'viewer',
                    soup: { items: [initiative('cached')], nextCursor: null },
                  },
                },
                stale: false,
                hasNext: false,
              };
            })()
          )
        )
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [cacheExchange, exchange],
    });
    const mount = () =>
      createRoot((cleanup) => {
        dispose = cleanup;
        return createProjectSoupSource(
          () => client,
          () => ({ sort: 'updated' }),
          () => true
        );
      });
    const first = mount();
    await vi.waitFor(() => expect(first.rows()?.[0].project.id).toBe('cached'));
    dispose?.();
    const second = mount();
    await vi.waitFor(() => expect(networkReads).toBe(2));
    expect(second.loading()).toBe(false);
    expect(second.rows()?.[0].project.id).toBe('cached');
    refresh.resolve();
  });
  function offlineFixture(empty = false) {
    let failure: CombinedError | undefined;
    const [filters, setFilters] = createSignal<ProjectFilters>({
      sort: 'updated',
    });
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        mergeMap((operation) =>
          fromPromise(
            Promise.resolve({
              operation,
              error: failure,
              data: failure
                ? undefined
                : {
                    user: {
                      id: 'viewer',
                      soup: {
                        items: empty ? [] : [initiative('cached')],
                        nextCursor: 'next',
                      },
                    },
                  },
              stale: false,
              hasNext: false,
            })
          )
        )
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [cacheExchange, exchange],
    });
    const source = createRoot((cleanup) => {
      dispose = cleanup;
      return createProjectSoupSource(
        () => client,
        filters,
        () => true
      );
    });
    return {
      source,
      setFilters,
      fail: (error: CombinedError) => {
        failure = error;
      },
    };
  }

  it.each([false, true])(
    'keeps a cached collection quiet on refresh failure (empty=%s)',
    async (empty) => {
      const f = offlineFixture(empty);
      await vi.waitFor(() =>
        expect(f.source.rows()).toHaveLength(empty ? 0 : 1)
      );
      const error = new CombinedError({
        networkError: new TypeError('Failed to fetch'),
      });
      f.fail(error);
      await expect(f.source.refresh()).rejects.toBe(error);
      expect(f.source.rows()).toHaveLength(empty ? 0 : 1);
      expect(f.source.error()).toBeUndefined();
    }
  );

  it('keeps errors for uncached filters and pagination visible', async () => {
    const f = offlineFixture();
    await vi.waitFor(() => expect(f.source.rows()).toHaveLength(1));
    const error = new CombinedError({
      networkError: new TypeError('Failed to fetch'),
    });
    f.fail(error);
    await f.source.loadMore();
    expect(f.source.rows()).toHaveLength(1);
    expect(f.source.error()).toBe(error);
    f.setFilters({ query: 'not cached' });
    await vi.waitFor(() => expect(f.source.error()).toBe(error));
    expect(f.source.rows()).toBeUndefined();
  });

  it.each([
    new CombinedError({ graphQLErrors: ['Forbidden'] }),
    ...[401, 403, 503].map(
      (status) =>
        new CombinedError({
          networkError: new Error('HTTP failure'),
          response: { status },
        })
    ),
  ])('preserves server errors alongside cached projects: %s', async (error) => {
    const f = offlineFixture();
    await vi.waitFor(() => expect(f.source.rows()).toHaveLength(1));
    f.fail(error);
    await expect(f.source.refresh()).rejects.toBe(error);
    expect(f.source.error()).toBe(error);
  });

  it('scopes all filters to initiatives and excludes folders and task documents', () => {
    const input = projectSoupInput({
      query: 'Roadmap',
      status: 'status-option',
      assignee: 'viewer',
      dueAfter: '2026-01-01',
      sort: 'created',
    });
    expect(input).toMatchObject({
      initial: {
        limit: 50,
        sortMethod: 'CREATED_AT',
        sortDirection: 'DESC',
        filters: {
          initiativeFilter: {
            and: {
              left: {
                and: {
                  left: { literal: { include: true } },
                  right: { literal: { nameContains: 'Roadmap' } },
                },
              },
              right: { literal: { dueAfter: '2026-01-01' } },
            },
          },
          propertiesFilter: {
            and: {
              left: {
                literal: {
                  entityType: 'INITIATIVE',
                  propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
                  value: { selectOption: 'status-option' },
                },
              },
              right: {
                literal: {
                  entityType: 'INITIATIVE',
                  propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
                  value: { entityRef: 'viewer' },
                },
              },
            },
          },
          documentFilter: {
            literal: { id: '00000000-0000-0000-0000-000000000000' },
          },
          projectFilter: {
            literal: { projectIdSelf: '00000000-0000-0000-0000-000000000000' },
          },
        },
      },
    });
  });
  it('combines created-by-me with name, dates, status, and assignee predicates', () => {
    const input = projectSoupInput({
      owner: 'creator',
      query: 'Launch',
      dueBefore: '2026-12-31',
      status: 'active',
      assignee: 'viewer',
    });
    expect(input.initial?.filters?.initiativeFilter).toEqual({
      and: {
        left: {
          and: {
            left: {
              and: {
                left: { literal: { include: true } },
                right: { literal: { owner: 'creator' } },
              },
            },
            right: { literal: { nameContains: 'Launch' } },
          },
        },
        right: { literal: { dueBefore: '2026-12-31' } },
      },
    });
    expect(input.initial?.filters?.propertiesFilter).toMatchObject({
      and: {
        left: {
          literal: {
            propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
            value: { selectOption: 'active' },
          },
        },
        right: {
          literal: {
            propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
            value: { entityRef: 'viewer' },
          },
        },
      },
    });
  });

  it('keeps canonical descending Soup cursors even for a legacy ascending preference', () => {
    expect(
      projectSoupInput({ sort: 'created', descending: false })
    ).toMatchObject({
      initial: { sortMethod: 'CREATED_AT', sortDirection: 'DESC' },
    });
  });

  it('maps initiatives with viewer permissions while keeping folders distinct', () => {
    const items = [
      initiative('launch'),
      { __typename: 'GraphqlSoupProject' },
    ] as ProjectSoupQuery['user']['soup']['items'];
    expect(projectSoupRows(items)).toEqual([
      {
        project: {
          id: 'launch',
          name: 'launch',
          updatedAt: '2026-09-27',
          createdAt: '2026-09-26',
          access: 'edit',
          appearance: null,
          taskCount: 8,
          completedTaskCount: 3,
        },
        properties: [],
      },
    ]);
  });
  it('uses Soup cursors, resets on filters, and gates reads and revalidation', async () => {
    let failure: CombinedError | undefined;
    const requests = vi.fn(async (operation) => ({
      error: failure,
      operation,
      data: failure
        ? undefined
        : {
            user: {
              id: 'viewer',
              soup: {
                items: [
                  initiative(
                    operation.variables.input.continuation ? 'second' : 'first'
                  ),
                ],
                nextCursor: operation.variables.input.continuation
                  ? null
                  : 'cursor',
              },
            },
          },
      stale: false,
      hasNext: false,
    }));
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        mergeMap((operation) => fromPromise(requests(operation)))
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const [enabled, setEnabled] = createSignal(false);
    const [search, setSearch] = createSignal('');
    const source = createRoot((cleanup) => {
      dispose = cleanup;
      return createProjectSoupSource(
        () => client,
        () => ({ query: search() }),
        enabled
      );
    });
    expect(requests).not.toHaveBeenCalled();
    setEnabled(true);
    await vi.waitFor(() =>
      expect(source.rows()?.map((r) => r.project.id)).toEqual(['first'])
    );
    await source.loadMore();
    await vi.waitFor(() =>
      expect(source.rows()?.map((r) => r.project.id)).toEqual([
        'first',
        'second',
      ])
    );
    expect(
      requests.mock.calls.some(
        ([op]) => op.variables.input.continuation?.cursor === 'cursor'
      )
    ).toBe(true);
    setSearch('new query');
    await vi.waitFor(() =>
      expect(source.rows()?.map((r) => r.project.id)).toEqual(['first'])
    );
    const beforeRefresh = requests.mock.calls.length;
    await refreshActiveGraphqlSoupQueries();
    expect(requests.mock.calls.length).toBeGreaterThan(beforeRefresh);
    failure = new CombinedError({ networkError: new Error('Offline') });
    await expect(source.refresh()).rejects.toThrow('Offline');
    expect(source.rows()?.map((row) => row.project.id)).toEqual(['first']);
    failure = new CombinedError({
      graphQLErrors: [{ message: 'Denied', extensions: { code: 'FORBIDDEN' } }],
    });
    await expect(source.refresh()).rejects.toThrow('Denied');
    expect(source.rows()).toBeUndefined();
    setEnabled(false);
    expect(source.rows()).toBeUndefined();
    const beforeDisabled = requests.mock.calls.length;
    await source.loadMore();
    await source.refresh();
    await refreshActiveGraphqlSoupQueries();
    expect(requests).toHaveBeenCalledTimes(beforeDisabled);
    expect(
      requests.mock.calls.every(([op]) =>
        op.query.definitions.some(
          (node: { kind: string; name?: { value: string } }) =>
            node.kind === 'OperationDefinition' &&
            node.name?.value === 'ProjectSoup'
        )
      )
    ).toBe(true);
  });
  it('updates initiatives optimistically without unrelated cache-only fields', async () => {
    let notify: Parameters<CacheHost['onOpsAffected']>[0] = () => {};
    let operationKey = 0;
    let patched = false;
    const appearance = { icon: { kind: 'emoji', value: '🚀' }, color: null };
    const initial = {
      user: {
        id: 'viewer',
        soup: {
          items: [{ ...initiative('project'), appearance: null }],
          nextCursor: null,
        },
      },
    };
    const host: CacheHost = {
      ...createNoopCacheHost(),
      disabled: false,
      watchQuery: async ({ opKey, query, since }) => {
        operationKey = opKey;
        // A loaded server response cannot satisfy another feature's cache-only
        // fields. The real engine reports a miss for this selection as well.
        if (query.includes('@cacheOnly'))
          return { kind: 'miss', revision: parseCacheRevision('1') };
        if (!patched || since === undefined) {
          return {
            kind: 'hit',
            revision: parseCacheRevision('1'),
            data: initial,
          };
        }
        return {
          kind: 'patch',
          revision: parseCacheRevision('2'),
          patches: [
            {
              path: ['user', 'soup', 'items', 0, 'appearance'],
              value: appearance,
            },
          ],
        };
      },
      onOpsAffected: (callback) => {
        notify = callback;
        return () => {};
      },
    };
    const network = vi.fn(async (operation: Operation) => ({
      operation,
      data: initial,
      stale: false,
      hasNext: false,
    }));
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        mergeMap((operation) => fromPromise(network(operation)))
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [normalizedCacheExchange(host), exchange],
    });
    const rows = createRoot((cleanup) => {
      dispose = cleanup;
      const source = createProjectSoupSource(
        () => client,
        () => ({}),
        () => true
      );
      return createMemo(source.rows);
    });
    await vi.waitFor(() => expect(rows()?.[0]?.project.appearance).toBeNull());
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    patched = true;
    notify([operationKey]);
    await vi.waitFor(() =>
      expect(rows()?.[0]?.project.appearance).toEqual(appearance)
    );
    expect(rows()?.[0]?.project.updatedAt).toBe('2026-09-27');
    expect(rows()?.map((row) => row.project.id)).toEqual(['project']);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
