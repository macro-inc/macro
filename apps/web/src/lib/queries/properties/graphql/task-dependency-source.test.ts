import { createClient, type Exchange } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, onTestFinished, vi } from 'vitest';
import { filter, map, pipe } from 'wonka';

const fixture = vi.hoisted(() => ({
  client: undefined as ReturnType<typeof createClient> | undefined,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => {
    if (!fixture.client) throw new Error('missing test client');
    return fixture.client;
  },
}));

import { createTaskDependencyStatesSource } from './task-dependency-source';

it('loads 1001 task facts in three requests and releases facts when the search closes', async () => {
  const requests: string[][] = [];
  const submitted = Promise.withResolvers<void>();
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === 'query'),
      map((operation) => {
        const raw: unknown = operation.variables?.taskIds;
        const ids = Array.isArray(raw)
          ? raw.filter((id: unknown): id is string => typeof id === 'string')
          : [];
        requests.push(ids);
        if (requests.length === 3) submitted.resolve();
        return {
          operation,
          stale: false,
          hasNext: false,
          data: {
            user: {
              id: 'viewer',
              taskDependencyStates: ids.map((id) => ({
                __typename: 'GraphqlTaskDependencyState',
                id,
                isBlocked: false,
                openBlockerIds: [],
                properties: [],
              })),
            },
          },
        };
      })
    );
  fixture.client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
  const ids = Array.from(
    { length: 1001 },
    (_, index) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
  );
  const [selected, setSelected] = createSignal([
    ...ids,
    ids[0],
    'optimistic-task',
  ]);
  const source = createRoot((dispose) => {
    onTestFinished(dispose);
    return createTaskDependencyStatesSource(selected);
  });
  await submitted.promise;
  expect(requests.map((request) => request.length)).toEqual([500, 500, 1]);
  expect(source.states().size).toBe(1001);
  setSelected([]);
  expect(source.states().size).toBe(0);
});
