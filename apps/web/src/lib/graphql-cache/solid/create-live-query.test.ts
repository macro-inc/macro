import { createClient, gql, type Operation } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { map, pipe } from 'wonka';
import {
  normalizedCacheExchange,
  normalizedCacheResultMetadata,
} from '../exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '../host/noop-host';
import { parseCacheRevision } from '../protocol';
import { createLiveQuery } from './create-live-query';

it('uses typed document variables, pauses undefined inputs and updates held objects', async () => {
  const doc = gql<
    { user: { name: string } },
    { id: string }
  >`query Viewer($id: ID!) { user(id:$id) { name } }`;
  let affected!: (keys: number[]) => void;
  let key = 0;
  const watchQuery = vi.fn().mockImplementation(async (args) => {
    key = args.opKey;
    return args.since === undefined
      ? {
          kind: 'hit',
          revision: parseCacheRevision('1'),
          data: { user: { name: args.variables.id } },
        }
      : {
          kind: 'patch',
          revision: parseCacheRevision('2'),
          patches: [{ path: ['user', 'name'], value: 'Updated' }],
        };
  });
  const client = createClient({
    url: '/graphql',
    exchanges: [
      normalizedCacheExchange({
        ...createNoopCacheHost(),
        disabled: false,
        watchQuery,
        onOpsAffected: (cb) => {
          affected = cb;
          return () => {};
        },
      }),
      () => (ops) =>
        pipe(
          ops,
          map((operation: Operation) => ({
            operation,
            data: {},
            stale: false,
            hasNext: false,
          }))
        ),
    ],
  });
  const state = createRoot((dispose) => {
    const [variables, setVariables] = createSignal<{ id: string }>();
    const query = createLiveQuery(doc, variables, () => ({
      client,
      requestPolicy: 'cache-only',
    }));
    return { query, setVariables, dispose };
  });
  try {
    expect(watchQuery).not.toHaveBeenCalled();
    state.setVariables({ id: 'First' });
    await vi.waitFor(() => expect(state.query.data?.user.name).toBe('First'));
    const user = state.query.data!.user;
    affected([key]);
    await vi.waitFor(() => expect(user.name).toBe('Updated'));
    expect(state.query.data!.user).toBe(user);
    state.setVariables({ id: 'Second' });
    await vi.waitFor(() => expect(state.query.data?.user.name).toBe('Second'));
  } finally {
    state.dispose();
  }
});

it('does not replay a network result or its persistence acknowledgement on a cache notification', async () => {
  const doc = gql<{ user: { name: string } }>`query Viewer { user { name } }`;
  let affected!: (keys: number[]) => void;
  let key = 0;
  const revision = parseCacheRevision;
  const watchQuery = vi
    .fn()
    .mockImplementationOnce(async (args) => {
      key = args.opKey;
      return { kind: 'miss', revision: revision('0') };
    })
    .mockResolvedValueOnce({
      kind: 'hit',
      revision: revision('1'),
      data: { user: { name: 'Server' } },
    })
    .mockResolvedValue({
      kind: 'patch',
      revision: revision('2'),
      patches: [{ path: ['user', 'name'], value: 'Optimistic' }],
    });
  const sources: string[] = [];
  const client = createClient({
    url: '/graphql',
    exchanges: [
      normalizedCacheExchange({
        ...createNoopCacheHost(),
        disabled: false,
        watchQuery,
        onOpsAffected: (cb) => {
          affected = cb;
          return () => {};
        },
      }),
      () => (ops) =>
        pipe(
          ops,
          map((operation: Operation) => ({
            operation,
            data: { user: { name: 'Server' } },
            stale: false,
            hasNext: false,
          }))
        ),
    ],
  });
  const state = createRoot((dispose) => ({
    dispose,
    query: createLiveQuery(
      doc,
      () => ({}),
      () => ({
        client,
        onResult: (result) => {
          sources.push(
            normalizedCacheResultMetadata(result)?.source ?? 'unknown'
          );
        },
      })
    ),
  }));
  try {
    await vi.waitFor(() => expect(watchQuery).toHaveBeenCalledTimes(2));
    const user = state.query.data!.user;
    affected([key]);
    await vi.waitFor(() => expect(user.name).toBe('Optimistic'));
    expect(sources.filter((source) => source === 'live-network')).toHaveLength(
      1
    );
    expect(state.query.data!.user).toBe(user);
  } finally {
    state.dispose();
  }
});
