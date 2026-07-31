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
const mapGraphqlSoupPageMock = vi.hoisted(() => vi.fn((data) => data));
const mapSoupPageToEntityListMock = vi.hoisted(() =>
  vi.fn((page) => page.items)
);

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: vi.fn() },
}));

vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => ({})),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: getGraphqlSoupClientMock,
  mapGraphqlSoupPage: mapGraphqlSoupPageMock,
}));

vi.mock('./graphql-ast', () => ({
  makeGraphqlSoupInput: vi.fn(() => ({ initial: { limit: 50 } })),
}));

vi.mock('./transform-utils', () => ({
  mapSoupPageToEntityList: mapSoupPageToEntityListMock,
}));

import { useReactiveSoupAstItemsQuery } from './reactive-items';

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

describe('useReactiveSoupAstItemsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retains identical page projections across cache re-executions', () => {
    const firstPage = {
      items: [{ id: 'task-1', type: 'document', name: 'Task' }],
      next_cursor: null,
    };
    const fake = makeFakeClient();
    getGraphqlSoupClientMock.mockReturnValue(fake.client);

    createRoot((dispose) => {
      const query = useReactiveSoupAstItemsQuery(
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
