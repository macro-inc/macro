import { createClient, type Exchange } from '@urql/core';
import { createEffect, createRoot, createSignal } from 'solid-js';
import { expect, it, onTestFinished, vi } from 'vitest';
import { filter, fromPromise, map, mergeMap, pipe } from 'wonka';

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
                visibleBlockerIds: [],
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

it('keeps sealed arrival-order batches when later pages append smaller IDs', async () => {
  const requests: string[][] = [];
  const initialReady = Promise.withResolvers<void>();
  const appendedReady = Promise.withResolvers<void>();
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
                visibleBlockerIds: [],
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
  const initial = Array.from(
    { length: 500 },
    (_, index) =>
      `00000000-0000-4000-8000-${(1500 - index).toString(16).padStart(12, '0')}`
  );
  const appended = Array.from(
    { length: 10 },
    (_, index) =>
      `00000000-0000-4000-8000-${(10 - index).toString(16).padStart(12, '0')}`
  );
  const [selected, setSelected] = createSignal(initial);
  const source = createRoot((dispose) => {
    onTestFinished(dispose);
    const source = createTaskDependencyStatesSource(selected);
    createEffect(() => {
      if (source.states().size === 500) initialReady.resolve();
      if (source.states().size === 510) appendedReady.resolve();
    });
    return source;
  });
  await initialReady.promise;
  expect(requests[0]).toEqual(initial);
  setSelected([...initial, ...appended]);
  await appendedReady.promise;
  expect(requests).toEqual([initial, appended]);
  expect(source.states().size).toBe(510);
});

it('tracks pending batch status without reading suspending data', async () => {
  const response = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) =>
        fromPromise(
          response.promise.then(() => ({
            operation,
            stale: false,
            hasNext: false,
            data: { user: { id: 'viewer', taskDependencyStates: [] } },
          }))
        )
      )
    );
  fixture.client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [exchange],
  });
  const [ids, setIds] = createSignal(['00000000-0000-4000-8000-000000000001']);
  const source = createRoot((dispose) => {
    onTestFinished(dispose);
    const source = createTaskDependencyStatesSource(ids);
    createEffect(() => {
      if (!source.pending()) settled.resolve();
    });
    return source;
  });
  expect(source.pending()).toBe(true);
  response.resolve();
  await settled.promise;
  expect(source.pending()).toBe(false);
  setIds([]);
  expect(source.pending()).toBe(false);
});
