import type { OperationResult } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

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
vi.mock('./optimistic-deletions', () => ({
  usePendingGraphqlSoupDeleteIds: () => () => new Set(),
  withoutPendingGraphqlSoupDeletes: (data: unknown) => data,
}));
vi.mock('./ast', () => ({
  makeGraphqlGroupedSoupInput: ({ body }: { body: unknown }) => body,
}));
vi.mock('../grouped/mail-date-groups', () => ({
  groupCachedMailByDate: (data: unknown) => data,
}));
vi.mock('../transform-utils', () => ({ mapSoupPageToEntityList: vi.fn() }));

import { createGraphqlGroupedSoupAstItemsQuery } from './grouped-items';

function fixture() {
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
      return { data: network, error: undefined };
    }
  );
  const root = createRoot((dispose) => ({
    dispose,
    query: createGraphqlGroupedSoupAstItemsQuery(
      () => ({
        params: {},
        body: { emailView: 'drafts' },
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
