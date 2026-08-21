import type {
  Client,
  GraphQLRequest,
  Operation,
  OperationContext,
  OperationResult,
} from '@urql/core';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';

const getGraphqlSoupClientMock = vi.hoisted(() => vi.fn());
const getGraphqlSoupCacheHostMock = vi.hoisted(() => vi.fn());
const entityFilterMock = vi.hoisted(() => vi.fn());
const readRecordsByKeysMock = vi.hoisted(() => vi.fn());
const mapGraphqlSoupPageMock = vi.hoisted(() => vi.fn((data) => data));
const mapSoupPageToEntityListMock = vi.hoisted(() =>
  vi.fn((page) => page.items)
);
const makeGraphqlSoupInputMock = vi.hoisted(() => vi.fn());

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => ({})),
}));

vi.mock('@app/lib/graphql-cache', () => ({
  selectRecords: vi.fn(() => ({})),
  readRecordsByKeys: readRecordsByKeysMock,
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
  getGraphqlSoupCacheHost: getGraphqlSoupCacheHostMock,
  mapGraphqlSoupItem: vi.fn((item) => item),
  mapGraphqlSoupPage: mapGraphqlSoupPageMock,
}));

vi.mock('./ast', () => ({
  makeGraphqlSoupInput: makeGraphqlSoupInputMock,
}));

vi.mock('../transform-utils', () => ({
  mapSoupPageToEntityList: mapSoupPageToEntityListMock,
}));

import { createGraphqlSoupAstItemsQuery } from './items';

type FakeExecution = {
  next(data: unknown): void;
};

function makeFakeClient(): {
  client: Client;
  executions: FakeExecution[];
} {
  const executions: FakeExecution[] = [];
  const execute = (
    _request: GraphQLRequest<unknown, Record<string, unknown>>,
    context: Partial<OperationContext>
  ) => {
    const subject =
      makeSubject<OperationResult<unknown, Record<string, unknown>>>();
    const operation = {
      kind: 'query',
      context,
    } as Operation<unknown, Record<string, unknown>>;
    executions.push({
      next: (data) =>
        subject.next({ operation, data } as OperationResult<
          unknown,
          Record<string, unknown>
        >),
    });
    return subject.source;
  };

  return {
    executions,
    client: {
      executeQuery: execute,
    } as unknown as Client,
  };
}

describe('createGraphqlSoupAstItemsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGraphqlSoupCacheHostMock.mockReturnValue(undefined);
    makeGraphqlSoupInputMock.mockReturnValue({
      initial: { limit: 50, sortMethod: 'UPDATED_AT' },
    });
  });

  it('does not run the local filter for the implicit VIEWED_AT sort', () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => undefined,
    });
    makeGraphqlSoupInputMock.mockReturnValue({ initial: { limit: 50 } });

    createRoot((dispose) => {
      createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );

      expect(fake.executions).toHaveLength(1);
      expect(entityFilterMock).not.toHaveBeenCalled();
      dispose();
    });
  });

  it('uses a complete local page as placeholder while authoritative network continues', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    getGraphqlSoupCacheHostMock.mockReturnValue({
      entityFilter: entityFilterMock,
      onCacheChanged: () => () => undefined,
    });
    entityFilterMock.mockResolvedValue({
      kind: 'complete',
      keys: ['GraphqlSoupDocument:task-1'],
      optimistic: false,
    });
    readRecordsByKeysMock.mockResolvedValue([
      {
        recordKey: 'GraphqlSoupDocument:task-1',
        record: { id: 'task-1', type: 'document', name: 'Local task' },
      },
    ]);

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }) as never,
          () => ({ enabled: true })
        );

        expect(fake.executions).toHaveLength(1);
        void vi
          .waitFor(() => {
            expect(query.isPlaceholderData()).toBe(true);
            expect(query.data()?.entities[0]?.name).toBe('Local task');
          })
          .then(() => {
            fake.executions[0]?.next({
              items: [{ id: 'task-1', type: 'document', name: 'Network task' }],
              next_cursor: null,
            });
            expect(query.isPlaceholderData()).toBe(false);
            expect(query.data()?.entities[0]?.name).toBe('Network task');
            dispose();
            resolve();
          });
      });
    });
    expect(entityFilterMock).toHaveBeenCalled();
  });

  it('keeps an optimistic local page until cache settlement', async () => {
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);
    let notifyCacheChanged: () => void = () => undefined;
    getGraphqlSoupCacheHostMock.mockReturnValue({
      entityFilter: entityFilterMock,
      onCacheChanged: (callback: () => void) => {
        notifyCacheChanged = callback;
        return () => undefined;
      },
    });
    entityFilterMock
      .mockResolvedValueOnce({
        kind: 'complete',
        keys: ['GraphqlSoupDocument:task-1'],
        optimistic: true,
      })
      .mockResolvedValueOnce({
        kind: 'complete',
        keys: ['GraphqlSoupDocument:task-1'],
        optimistic: false,
      });
    readRecordsByKeysMock.mockResolvedValue([
      {
        recordKey: 'GraphqlSoupDocument:task-1',
        record: { id: 'task-1', type: 'document', name: 'Optimistic task' },
      },
    ]);

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const query = createGraphqlSoupAstItemsQuery(
          () => ({ params: {}, body: {} }) as never,
          () => ({ enabled: true })
        );

        void vi
          .waitFor(() => {
            expect(query.data()?.entities[0]?.name).toBe('Optimistic task');
            expect(query.isPlaceholderData()).toBe(true);
          })
          .then(async () => {
            fake.executions[0]?.next({
              items: [{ id: 'task-1', type: 'document', name: 'Network task' }],
              next_cursor: null,
            });
            expect(query.data()?.entities[0]?.name).toBe('Optimistic task');

            notifyCacheChanged();
            await vi.waitFor(() => {
              expect(entityFilterMock).toHaveBeenCalledTimes(2);
              expect(query.data()?.entities[0]?.name).toBe('Network task');
              expect(query.isPlaceholderData()).toBe(false);
            });
            dispose();
            resolve();
          });
      });
    });
  });

  it('retains identical page projections across cache re-executions', () => {
    const firstPage = {
      items: [{ id: 'task-1', type: 'document', name: 'Task' }],
      next_cursor: null,
    };
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);

    createRoot((dispose) => {
      const query = createGraphqlSoupAstItemsQuery(
        () => ({ params: {}, body: {} }) as never,
        () => ({ enabled: true })
      );

      expect(fake.executions).toHaveLength(1);
      fake.executions[0]?.next(firstPage);

      const initial = query.data();
      const initialEntity = initial?.entities[0];
      expect(initialEntity).toEqual(firstPage.items[0]);

      fake.executions[0]?.next(structuredClone(firstPage));
      expect(query.data()).toBe(initial);
      expect(query.data()?.entities[0]).toBe(initialEntity);

      fake.executions[0]?.next({
        ...firstPage,
        items: [{ ...firstPage.items[0], name: 'Updated task' }],
      });
      expect(query.data()?.entities[0]).toBe(initialEntity);
      expect(query.data()?.entities[0]?.name).toBe('Updated task');

      dispose();
    });
  });
});
