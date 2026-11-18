import { QueryClient } from '@tanstack/solid-query';
import { CombinedError, createClient, type Exchange } from '@urql/core';
import { err, ok, type Result } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { fromPromise, mergeMap, pipe } from 'wonka';
import { createProjectSoupSource } from '../../projects/queries/project-soup';
import type { EntityAppearance } from '../core/appearance';
import { createSaveEntityAppearance } from './appearance';

let queryClient: QueryClient;
let dispose: (() => void) | undefined;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return queryClient;
  },
}));
vi.mock('@queries/preview', () => ({ setPreviewAppearance: vi.fn() }));
vi.mock('@queries/soup/cache', () => ({ getSoupEntityById: () => undefined }));
vi.mock('@service-storage/graphql-soup', () => ({
  mapGraphqlProperties: () => [],
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: () => () => {},
}));

afterEach(() => {
  dispose?.();
  queryClient.clear();
});

it.each(['success', 'rejected', 'refresh-failure'] as const)(
  'updates uncached project rows through %s',
  async (outcome) => {
    const success = outcome !== 'rejected';
    let readFailure = false;
    queryClient = new QueryClient();
    const initialRead = Promise.withResolvers<void>();
    let saved: EntityAppearance | null = null;
    const network = vi.fn();
    const exchange: Exchange = () => (operations) =>
      pipe(
        operations,
        mergeMap((operation) =>
          fromPromise(
            (async () => {
              network();
              const result = {
                operation,
                data: {
                  user: {
                    id: 'viewer',
                    soup: {
                      items: [
                        {
                          __typename: 'GraphqlSoupInitiative',
                          id: 'project-1',
                          displayName: 'Project',
                          appearance: saved,
                          metadata: {
                            createdAt: '2026-10-01',
                            updatedAt: '2026-10-01',
                          },
                          viewerPermission: {
                            __typename: 'GraphqlAccessLevelPermission',
                            accessLevel: 'EDIT',
                          },
                          properties: [],
                        },
                      ],
                      nextCursor: null,
                    },
                  },
                },
                stale: false,
                hasNext: false,
              };
              initialRead.resolve();
              return readFailure
                ? {
                    ...result,
                    data: undefined,
                    error: new CombinedError({
                      networkError: new Error('Offline'),
                    }),
                  }
                : result;
            })()
          )
        )
      );
    const client = createClient({
      url: 'http://test.invalid/graphql',
      exchanges: [exchange],
    });
    const source = createRoot((cleanup) => {
      dispose = cleanup;
      return createProjectSoupSource(
        () => client,
        () => ({}),
        () => true
      );
    });
    await initialRead.promise;
    // Wait for the source's own first request, rather than polling rendering.
    await source.refresh();
    expect(source.rows()?.[0].project.appearance).toBeNull();
    network.mockClear();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Result<unknown, unknown>>();
    const refreshStarted = Promise.withResolvers<void>();
    const refreshAllowed = Promise.withResolvers<void>();
    const refresh = vi.fn(async () => {
      refreshStarted.resolve();
      await refreshAllowed.promise;
      await source.refresh();
    });
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => undefined,
      update: async (_type, _id, appearance) => {
        started.resolve();
        const result = await response.promise;
        if (result.isOk()) saved = appearance;
        return result;
      },
      refreshUncached: refresh,
    });
    const appearance: EntityAppearance = {
      icon: { kind: 'emoji', value: '🚀' },
      color: null,
    };
    const pending = save(
      {
        type: 'initiative',
        id: 'project-1',
        name: 'Project',
        ownerId: 'viewer',
      },
      appearance,
      () => true
    );
    await started.promise;
    expect(source.rows()?.[0].project.appearance).toEqual(appearance);
    expect(source.rows()?.[0].project.updatedAt).toBe('2026-10-01');
    expect(network).not.toHaveBeenCalled();
    response.resolve(success ? ok(undefined) : err('rejected'));
    if (success) {
      await refreshStarted.promise;
      expect(source.rows()?.[0].project.appearance).toEqual(appearance);
      readFailure = outcome === 'refresh-failure';
      refreshAllowed.resolve();
    }
    expect((await pending).isOk()).toBe(success);
    expect(source.rows()?.[0].project.appearance).toEqual(
      success ? appearance : null
    );
    expect(refresh).toHaveBeenCalledTimes(success ? 1 : 0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(
      readFailure ? 1 : 0
    );
    if (readFailure) {
      readFailure = false;
      saved = { icon: { kind: 'emoji', value: '🌿' }, color: null };
      await source.refresh();
      expect(source.rows()?.[0].project.appearance).toEqual(saved);
      await save(
        {
          type: 'initiative',
          id: 'project-1',
          name: 'Project',
          ownerId: 'viewer',
        },
        saved,
        () => true
      );
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    }
  }
);
