import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { gql } from '@urql/core';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { selectRecords } from '../../../graphql-cache/exchange/record-selection';
import { createNoopCacheHost } from '../../../graphql-cache/host/noop-host';
import type {
  CacheChangeListener,
  CacheHost,
} from '../../../graphql-cache/host/types';
import {
  type EntityFilterCacheArgs,
  type EntityFilterCacheResult,
  type LiveQueryUpdate,
  parseCacheRevision,
} from '../../../graphql-cache/protocol';
import { createPredicateQuery } from './create-predicate-query';

type Row = {
  id: string;
  name: string;
  read: boolean;
  nested: { count: number };
};
const selection = selectRecords(
  gql`fragment Item on GraphqlSoupEmailThread { id name read: isRead }` as TypedDocumentNode<Row>
);
const request = {
  source: {
    filters: {},
    sortMethod: 'UPDATED_AT' as const,
    sortDirection: 'DESC' as const,
    limit: 20,
    baseline: [],
  },
  select: selection,
};
const revision = parseCacheRevision;
const identity = { mutationUuid: null, pending: false };
function snapshot(): LiveQueryUpdate {
  return {
    kind: 'live-query',
    revision: revision('1'),
    reset: true,
    keys: ['a', 'b'],
    upserts: ['a', 'b'].map((id) => ({
      recordKey: id,
      identity,
      record: { id, name: id, read: false, nested: { count: 0 } },
    })),
    patches: [],
    removed: [],
    retainedKeys: [],
    optimistic: false,
  };
}
function patch(rev = '2'): LiveQueryUpdate {
  return {
    kind: 'live-query',
    revision: revision(rev),
    reset: false,
    upserts: [],
    patches: [
      { recordKey: 'a', fields: [{ path: ['read'], value: true }], identity },
    ],
    removed: [],
    retainedKeys: [],
    optimistic: false,
  };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((dispose) => dispose());
});
function setup(onRead: () => void = () => {}) {
  const listeners = new Set<CacheChangeListener>();
  const generations = new Set<
    Parameters<CacheHost['onCacheGenerationChanged']>[0]
  >();
  const requests: Array<{
    args: EntityFilterCacheArgs;
    resolve: (value: EntityFilterCacheResult) => void;
  }> = [];
  const host: CacheHost = {
    ...createNoopCacheHost(),
    onCacheChanged: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    onCacheGenerationChanged: (cb) => {
      generations.add(cb);
      return () => {
        generations.delete(cb);
      };
    },
    entityFilter: (args) => {
      onRead();
      return args.liveQuery?.release
        ? Promise.resolve({ kind: 'unsupported' })
        : new Promise((resolve) => requests.push({ args, resolve }));
    },
  };
  const state = createRoot((dispose) => {
    cleanups.push(dispose);
    const [input, setInput] = createSignal<typeof request | undefined>(request);
    const query = createPredicateQuery({ host: () => host, query: input });
    return { query, dispose, setInput };
  });
  return {
    ...state,
    requests,
    listeners,
    generations,
    change: (rev: string) => listeners.forEach((cb) => cb(revision(rev))),
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

it('updates only subscribed fields and retains row and array identity', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  const rows = state.query.data()!.records;
  const first = rows[0].record;
  let reads = 0;
  let names = 0;
  let others = 0;
  createRoot((dispose) => {
    cleanups.push(dispose);
    createComputed(() => {
      first.read;
      reads++;
    });
    createComputed(() => {
      first.name;
      names++;
    });
    createComputed(() => {
      rows[1].record.read;
      others++;
    });
  });
  state.change('2');
  expect(state.requests[1].args.liveQuery?.since).toBe('1');
  state.requests[1].resolve(patch());
  await flush();
  expect(state.query.data()!.records).toBe(rows);
  expect(state.query.data()!.records[0].record).toBe(first);
  expect([reads, names, others]).toEqual([2, 1, 1]);
});

it('applies membership and value changes atomically', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  state.change('2');
  state.requests[1].resolve({ ...patch(), keys: ['a'], removed: ['b'] });
  await flush();
  expect(
    state.query.data()!.records.map((row) => [row.record.id, row.record.read])
  ).toEqual([['a', true]]);
});

it('coalesces writes during a read and rejects a superseded snapshot', async () => {
  const state = setup();
  state.change('2');
  state.change('3');
  expect(state.requests).toHaveLength(1);
  state.requests[0].resolve(snapshot());
  await flush();
  expect(state.query.data()).toBeUndefined();
  expect(state.requests).toHaveLength(2);
  state.requests[1].resolve({ ...snapshot(), revision: revision('3') });
  await flush();
  expect(state.query.data()!.revision).toBe('3');
});

it('discards in-flight work on query changes and disposal', async () => {
  const state = setup();
  state.setInput({
    ...request,
    source: { ...request.source, filters: { changed: true } },
  });
  expect(state.requests).toHaveLength(2);
  state.requests[0].resolve(snapshot());
  await flush();
  expect(state.query.data()).toBeUndefined();
  state.dispose();
  state.requests[1].resolve(snapshot());
  await flush();
  expect(state.query.data()).toBeUndefined();
  expect(state.listeners.size).toBe(0);
  expect(state.generations.size).toBe(0);
});

it('does not resubscribe when only request object identity changes', async () => {
  const state = setup();
  state.setInput({ ...request, source: { ...request.source } });
  expect(state.requests).toHaveLength(1);
});

it('reports unsupported sources without publishing an empty result', async () => {
  const state = setup();
  state.requests[0].resolve({ kind: 'unsupported' });
  await flush();
  expect(state.query.status()).toBe('unsupported');
  expect(state.query.data()).toBeUndefined();
  state.change('2');
  state.query.refresh();
  expect(state.requests).toHaveLength(1);
  state.generations.forEach((callback) => callback({ storage: 'reset' }));
  expect(state.requests).toHaveLength(2);
});

it('discards old-generation reads and restarts without a cursor', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  state.change('2');
  state.generations.forEach((callback) => callback({ storage: 'reset' }));
  expect(state.query.data()).toBeUndefined();
  state.requests[1].resolve(patch());
  await flush();
  expect(state.requests[2].args.liveQuery?.since).toBeUndefined();
  expect(state.query.data()).toBeUndefined();
  state.requests[2].resolve(snapshot());
  await flush();
  expect(state.query.data()?.records[0].record.read).toBe(false);
});

it('does not recreate held rows when host setup reads an unrelated signal', async () => {
  const [incidental, setIncidental] = createSignal(false);
  const state = setup(incidental);
  state.requests[0].resolve(snapshot());
  await flush();
  const rows = state.query.data()!.records;
  setIncidental(true);
  await flush();
  expect(state.requests).toHaveLength(1);
  expect(state.query.data()!.records).toBe(rows);
});
