import { UNKNOWN_CACHE_GENERATION } from '@graphql-cache/generation-mirror';
import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { QueryClient } from '@tanstack/solid-query';
import {
  type Client,
  CombinedError,
  createClient,
  type Exchange,
} from '@urql/core';
import { buildSchema, execute, parse } from 'graphql';
import { err, ok, type Result } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { fromPromise, mergeMap, pipe } from 'wonka';
import schemaSdl from '../../../../../../static_assets/schema.graphql?raw';
import { refreshSavedViewReaders } from '../../saved-views/queries/active-queries';
import {
  useSavedView,
  useSavedViews,
} from '../../saved-views/queries/saved-views';
import {
  type EntityAppearance,
  readEntityAppearance,
} from '../core/appearance';
import { createSaveEntityAppearance } from './appearance';
import { appearanceAdapter } from './appearance-readers';

let queryClient: QueryClient;
let client: Client;
let dispose: (() => void) | undefined;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return queryClient;
  },
}));
vi.mock('@queries/preview', () => ({ setPreviewAppearance: vi.fn() }));
vi.mock('@queries/soup/cache', () => ({ getSoupEntityById: () => undefined }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => client,
}));
vi.mock('../../saved-views/queries/saved-view-changes', () => ({
  refreshOnSavedViewChanges: () => {},
}));

afterEach(() => {
  dispose?.();
  queryClient.clear();
});

it('routes saved definitions independently of Soup and unrelated REST readers', () => {
  queryClient = new QueryClient();
  expect(appearanceAdapter(queryClient, 'saved_view', 'view-1')).toEqual({
    apiType: 'saved_view',
    graphql: { tag: 'saved_view', typename: 'GraphqlSavedView' },
    readers: [],
  });
});

it.each(['success', 'rejected', 'refresh-failure'] as const)(
  'reconciles saved-view list and detail through %s without changing the definition',
  async (outcome) => {
    queryClient = new QueryClient();
    let saved: EntityAppearance | null = null;
    let readFailure = false;
    const record = () => ({
      __typename: 'GraphqlSavedView',
      id: 'view-1',
      ownerId: 'viewer',
      name: 'My view',
      config: { kind: 'tasks', version: 1 },
      sharedTeamId: null,
      revision: 4,
      appearance: saved,
      createdAt: '2026-10-01',
      updatedAt: '2026-10-02',
    });
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        mergeMap((operation) =>
          fromPromise(
            Promise.resolve({
              operation,
              data: readFailure
                ? undefined
                : {
                    user: {
                      id: 'viewer',
                      savedView: record(),
                      savedViews: { nodes: [record()], nextCursor: null },
                    },
                  },
              error: readFailure
                ? new CombinedError({ networkError: new Error('Offline') })
                : undefined,
              stale: false,
              hasNext: false,
            })
          )
        )
      );
    client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const source = createRoot((cleanup) => {
      dispose = cleanup;
      return {
        list: useSavedViews({ viewerId: () => 'viewer', kind: 'tasks' }),
        detail: useSavedView({ viewerId: () => 'viewer', id: () => 'view-1' }),
      };
    });
    await refreshSavedViewReaders(client, 'view-1');
    expect(source.detail.data()?.appearance).toBeNull();
    const initial = source.detail.data();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Result<unknown, unknown>>();
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => undefined,
      update: async (_type, _id, appearance) => {
        started.resolve();
        const result = await response.promise;
        if (result.isOk()) saved = appearance;
        return result;
      },
      refreshUncached: () => refreshSavedViewReaders(client, 'view-1'),
    });
    const appearance: EntityAppearance = {
      icon: { kind: 'macro', name: 'star' },
      color: 'blue',
    };
    const pending = save(
      { type: 'saved_view', id: 'view-1', name: 'My view', ownerId: 'viewer' },
      appearance,
      () => true
    );
    await started.promise;
    expect(source.list.items()?.[0].appearance).toEqual(appearance);
    expect(source.detail.data()).toEqual({ ...initial, appearance });
    readFailure = outcome === 'refresh-failure';
    response.resolve(outcome === 'rejected' ? err('rejected') : ok(undefined));
    expect((await pending).isOk()).toBe(outcome !== 'rejected');
    expect(source.list.items()?.[0].appearance).toEqual(
      outcome === 'rejected' ? null : appearance
    );
    expect(source.detail.data()).toEqual({
      ...initial,
      appearance: outcome === 'rejected' ? null : appearance,
    });
    if (readFailure) {
      readFailure = false;
      saved = { icon: { kind: 'emoji', value: '🌿' }, color: null };
      await refreshSavedViewReaders(client, 'view-1');
      expect(source.list.items()?.[0].appearance).toEqual(saved);
      expect(source.detail.data()?.appearance).toEqual(saved);
    }
  }
);

it('patches the saved-view GraphQL identity optimistically and rolls back a rejected write', async () => {
  queryClient = new QueryClient();
  const record = {
    __typename: 'GraphqlSavedView',
    id: 'view-1',
    appearance: null as EntityAppearance | null,
  };
  const patched = Promise.withResolvers<void>();
  const response = Promise.withResolvers<Result<unknown, unknown>>();
  const writes: unknown[] = [];
  const host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async () => ({
      revision: INITIAL_CACHE_REVISION,
      records: [{ recordKey: 'GraphqlSavedView:view-1', record }],
    })),
    writeQuery: vi.fn<CacheHost['writeQuery']>(async (write) => {
      expect(write.generation).toBe(UNKNOWN_CACHE_GENERATION);
      const result = await execute({
        schema: buildSchema(schemaSdl),
        document: parse(write.query),
        operationName: write.operationName,
        variableValues: write.variables,
        rootValue: write.data,
      });
      expect(result.errors).toBeUndefined();
      const update = result.data?.updateSavedView;
      if (!update || typeof update !== 'object' || !('appearance' in update)) {
        throw new Error('Expected a saved-view appearance patch');
      }
      writes.push(update);
      record.appearance = readEntityAppearance(update.appearance);
      patched.resolve();
      return {
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    }),
  };
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => host,
    update: () => response.promise,
  });
  const appearance: EntityAppearance = {
    icon: { kind: 'emoji', value: '🚀' },
    color: 'green',
  };
  const pending = save(
    { type: 'saved_view', id: record.id, name: 'My view', ownerId: 'viewer' },
    appearance,
    () => true
  );
  await patched.promise;
  expect(record.appearance).toEqual(appearance);
  expect(writes).toEqual([
    { __typename: 'GraphqlSavedView', id: record.id, appearance },
  ]);
  response.resolve(err('rejected'));
  expect((await pending).isErr()).toBe(true);
  expect(record.appearance).toBeNull();
});

it('does not refresh a new account after delayed GraphQL confirmation', async () => {
  queryClient = new QueryClient();
  let current = true;
  const confirmationStarted = Promise.withResolvers<void>();
  const confirmation = Promise.withResolvers<void>();
  let reads = 0;
  const host = {
    disabled: false,
    readRecordsByKeys: vi.fn(async () => {
      if (++reads === 2) {
        confirmationStarted.resolve();
        await confirmation.promise;
      }
      return {
        revision: INITIAL_CACHE_REVISION,
        records: [
          {
            recordKey: 'GraphqlSavedView:view-1',
            record: {
              __typename: 'GraphqlSavedView',
              id: 'view-1',
              appearance: null,
            },
          },
        ],
      };
    }),
    writeQuery: vi.fn<CacheHost['writeQuery']>(async () => ({
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: [],
      affectedOps: [],
      reset: false,
    })),
  };
  const refresh = vi.fn(async () => {});
  const save = createSaveEntityAppearance({
    queryClient,
    cacheHost: () => host,
    update: async () => ok(undefined),
    refreshUncached: refresh,
  });
  const pending = save(
    { type: 'saved_view', id: 'view-1', name: 'My view', ownerId: 'viewer' },
    { icon: { kind: 'emoji', value: '🚀' }, color: null },
    () => current
  );
  await confirmationStarted.promise;
  current = false;
  confirmation.resolve();
  await pending;
  expect(refresh).not.toHaveBeenCalled();
});
