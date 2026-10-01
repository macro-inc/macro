import type { OperationResult } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  query: vi.fn(),
}));
vi.mock('./items', () => ({ createGraphqlSoupAstItemsQuery: mocks.local }));
vi.mock('@app/lib/urql-solid', () => ({ createUrqlQuery: mocks.query }));
vi.mock('@app/lib/graphql-cache', () => ({
  normalizedCacheResultMetadata: (result: { metadata: unknown }) =>
    result.metadata,
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: () => ({}),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
  mapGraphqlGroupedSoupPage: vi.fn(),
}));
vi.mock('./active-queries', () => ({
  registerGraphqlSoupRevalidations: () => () => {},
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});
vi.mock('./ast', () => ({
  makeGraphqlGroupedSoupInput: ({ body }: { body: unknown }) => body,
}));
vi.mock('../grouped/mail-date-groups', () => ({
  groupCachedMailByDate: (data: unknown) => data,
}));
vi.mock('../transform-utils', () => ({ mapSoupPageToEntityList: vi.fn() }));

import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { createGraphqlGroupedSoupAstItemsQuery } from './grouped-items';
import { hideGraphqlSoupEntitiesAsDone } from './optimistic-done';

beforeEach(() => {
  queryClient.clear();
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    userId: 'viewer',
    authenticated: true,
  });
});

function fixture(emailView: 'inbox' | 'drafts' | 'all' = 'drafts') {
  const local = { cachedMail: true, entities: [{ id: 'offline-draft' }] };
  const network = { entities: [{ id: 'server-draft' }] };
  const [optimistic, setOptimistic] = createSignal(true);
  const [revision, setRevision] = createSignal('1');
  let onResult!: (result: OperationResult) => void;
  mocks.local.mockReturnValue({
    data: () => local,
    localRevision: revision,
    localOptimistic: optimistic,
  });
  mocks.query.mockImplementation(
    (options: () => { onResult: typeof onResult }) => {
      onResult = options().onResult;
      return { data: { viewerId: 'viewer', data: network }, error: undefined };
    }
  );
  const root = createRoot((dispose) => ({
    dispose,
    query: createGraphqlGroupedSoupAstItemsQuery(
      () => ({
        params: {},
        body: { emailView },
        groupBy: { type: 'date', field: 'updated_at' },
      }),
      () => ({ enabled: true })
    ),
  }));
  return {
    ...root,
    local,
    network,
    setOptimistic,
    setRevision,
    publish(persistence: Promise<string | undefined>) {
      onResult({
        data: {},
        metadata: { source: 'live-network', persistence },
      } as unknown as OperationResult);
    },
  };
}

describe('grouped Mail cache acknowledgement', () => {
  it('retains pending drafts through network persistence, then accepts the settled server page', async () => {
    const f = fixture();
    const write = Promise.withResolvers<string | undefined>();
    try {
      expect(f.query.data()).toBe(f.local);
      f.publish(write.promise);
      expect(f.query.data()).toBe(f.local);
      write.resolve('1');
      await write.promise;
      expect(f.query.data()).toBe(f.local);
      f.setOptimistic(false);
      expect(f.query.data()).toBe(f.network);
    } finally {
      f.dispose();
    }
  });

  it('ignores an older acknowledgement after a newer network result', async () => {
    const f = fixture();
    const first = Promise.withResolvers<string | undefined>();
    const second = Promise.withResolvers<string | undefined>();
    try {
      f.setOptimistic(false);
      f.publish(first.promise);
      f.publish(second.promise);
      second.resolve('2');
      await second.promise;
      f.setRevision('2');
      expect(f.query.data()).toBe(f.network);
      first.resolve('1');
      await first.promise;
      expect(f.query.data()).toBe(f.network);
    } finally {
      f.dispose();
    }
  });
});

describe('grouped Mail pending done filtering', () => {
  it.each(['local', 'network'] as const)(
    'hides done items from the %s inbox projection and restores them on undo',
    async (source) => {
      const f = fixture('inbox');
      const data = f[source];
      const overlay = hideGraphqlSoupEntitiesAsDone({
        entityIds: data.entities.map(({ id }) => id),
        notificationIds: [],
      });
      try {
        if (source === 'network') {
          f.setOptimistic(false);
          const persistence = Promise.resolve('1');
          f.publish(persistence);
          await persistence;
        }
        await vi.waitFor(() => {
          expect(f.query.data()?.entities).toEqual([]);
        });
        overlay.release();
        await vi.waitFor(() => {
          expect(f.query.data()).toBe(data);
        });
      } finally {
        overlay.release();
        f.dispose();
      }
    }
  );

  it.each(['local', 'network'] as const)(
    'restores a removed %s inbox row immediately on Undo',
    async (source) => {
      const f = fixture('inbox');
      if (source === 'network') {
        f.setOptimistic(false);
        const persistence = Promise.resolve('1');
        f.publish(persistence);
        await persistence;
      }
      const data = f[source];
      const id = data.entities[0].id;
      const overlay = hideGraphqlSoupEntitiesAsDone({
        entityIds: [id],
        notificationIds: [],
      });
      try {
        await vi.waitFor(() => expect(f.query.data()?.entities).toEqual([]));
        data.entities.length = 0; // The selected cache/server source has caught up with Done.
        overlay.setDone(false);
        await vi.waitFor(() =>
          expect(f.query.data()?.entities.map((e) => e.id)).toEqual([id])
        );
        expect(data.entities).toEqual([]); // Undo never writes back into the source.
      } finally {
        overlay.release();
        f.dispose();
      }
    }
  );

  it.each(['local', 'network'] as const)(
    'updates the All done indicator in the %s projection without removing the row',
    async (source) => {
      const f = fixture('all');
      const data = f[source];
      const entity = Object.assign(data.entities[0], {
        type: 'email',
        done: false,
      });
      if (source === 'network') {
        f.setOptimistic(false);
        const persistence = Promise.resolve('1');
        f.publish(persistence);
        await persistence;
      }
      const overlay = hideGraphqlSoupEntitiesAsDone({
        entityIds: [entity.id],
        notificationIds: [],
      });
      try {
        await vi.waitFor(() =>
          expect(f.query.data()?.entities[0]).toMatchObject({
            id: entity.id,
            done: true,
          })
        );
        expect(entity.done).toBe(false);
        overlay.setDone(false);
        await vi.waitFor(() =>
          expect(f.query.data()?.entities[0]).toMatchObject({
            id: entity.id,
            done: false,
          })
        );
      } finally {
        overlay.release();
        f.dispose();
      }
    }
  );

  it('keeps cached drafts visible when the view includes done items', async () => {
    const f = fixture();
    const overlay = hideGraphqlSoupEntitiesAsDone({
      entityIds: ['offline-draft'],
      notificationIds: [],
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(f.query.data()).toBe(f.local);
    } finally {
      overlay.release();
      f.dispose();
    }
  });
});
