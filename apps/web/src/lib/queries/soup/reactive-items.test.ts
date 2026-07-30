import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createQuerySignalMock = vi.hoisted(() => vi.fn());
const mapGraphqlSoupPageMock = vi.hoisted(() => vi.fn((data) => data));
const mapSoupPageToEntityListMock = vi.hoisted(() =>
  vi.fn((page) => page.items)
);

vi.mock('@graphql-cache/solid/create-query-signal', () => ({
  createQuerySignal: createQuerySignalMock,
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => ({})),
}));

vi.mock('@service-storage/graphql/generated/graphql', () => ({
  SoupDocument: {},
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(() => ({})),
  mapGraphqlSoupPage: mapGraphqlSoupPageMock,
}));

vi.mock('./graphql-ast', () => ({
  makeGraphqlSoupInput: vi.fn(() => ({ initial: { limit: 50 } })),
}));

vi.mock('./transform-utils', () => ({
  mapSoupPageToEntityList: mapSoupPageToEntityListMock,
}));

import { useReactiveSoupAstItemsQuery } from './reactive-items';

describe('useReactiveSoupAstItemsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retains identical page projections across cache re-executions', () => {
    const firstPage = {
      items: [{ id: 'task-1', type: 'document', name: 'Task' }],
      next_cursor: null,
    };
    const [queryData, setQueryData] = createSignal<unknown>(firstPage);
    createQuerySignalMock.mockReturnValue({
      data: queryData,
      error: () => undefined,
      fetching: () => false,
      stale: () => false,
    });

    createRoot((dispose) => {
      const query = useReactiveSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );

      const initial = query.data();
      expect(initial?.entities[0]).toEqual(firstPage.items[0]);

      setQueryData(structuredClone(firstPage));
      expect(query.data()).toBe(initial);

      setQueryData({
        ...firstPage,
        items: [{ ...firstPage.items[0], name: 'Updated task' }],
      });
      expect(query.data()).not.toBe(initial);
      expect(query.data()?.entities[0]?.name).toBe('Updated task');

      dispose();
    });
  });
});
