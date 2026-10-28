import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import {
  CombinedError,
  cacheExchange,
  createClient,
  type Exchange,
} from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
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

import type { SoupQuery } from '@service-storage/graphql/generated/graphql';
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
  entityType: 'INITIATIVE' as const,
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
      { __typename: 'GraphqlSoupProject', id: 'folder' },
    ] as SoupQuery['user']['soup']['items'];
    expect(projectSoupRows(items)).toEqual([
      {
        project: {
          id: 'launch',
          name: 'launch',
          updatedAt: '2026-09-27',
          createdAt: '2026-09-26',
          access: 'edit',
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
            node.kind === 'OperationDefinition' && node.name?.value === 'Soup'
        )
      )
    ).toBe(true);
  });
});
