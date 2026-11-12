import { soupKeys } from '@queries/soup/keys';
import { initSoupNormalizer } from '@queries/soup/normalized-cache/normalizer';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { err, type Result } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import type { EntityData } from '../../entity/types/entity';
import { createSaveEntityAppearance } from './appearance';

let queryClient: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return queryClient;
  },
}));
vi.mock('@queries/preview', () => ({ setPreviewAppearance: vi.fn() }));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  queryClient.clear();
});

it.each(['document', 'initiative'] as const)(
  'updates a loaded REST Soup %s before saving and rolls back only appearance',
  async (type) => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    cleanups.push(initSoupNormalizer(queryClient));
    const row = {
      tag: type,
      data: {
        id: 'entity-1',
        name: 'Example',
        fileType: 'md',
        ownerId: 'viewer',
        appearance: null,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
        properties: [],
      },
      frecency_score: 1,
    };
    const key = [...soupKeys.astItems._def, 'appearance'];
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: async () => ({
        pages: [{ kind: 'flat', items: [row], nextCursor: null }],
        pageParams: [null],
      }),
      meta: { normalize: true },
    });
    cleanups.push(observer.subscribe(() => {}));
    await observer.refetch();
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Result<unknown, unknown>>();
    const save = createSaveEntityAppearance({
      queryClient,
      cacheHost: () => undefined,
      update: () => {
        started.resolve();
        return response.promise;
      },
    });
    const appearance = {
      icon: { kind: 'emoji' as const, value: '🚀' },
      color: null,
    };
    const entity: EntityData = {
      ...(type === 'document' ? { type, fileType: 'md' } : { type }),
      id: row.data.id,
      name: row.data.name,
      ownerId: row.data.ownerId,
    };
    const pending = save(entity, appearance, () => true);
    await started.promise;
    expect(
      observer.getCurrentResult().data?.pages[0].items[0].data.appearance
    ).toEqual(appearance);
    expect(
      observer.getCurrentResult().data?.pages[0].items[0].data.updatedAt
    ).toBe(row.data.updatedAt);
    response.resolve(err('rejected'));
    expect((await pending).isErr()).toBe(true);
    expect(
      observer.getCurrentResult().data?.pages[0].items[0].data.appearance
    ).toBeNull();
  }
);
