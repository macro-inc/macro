import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { Telemetry } from '@macro-inc/observability';
import { gql } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { selectRecords } from '../../../graphql-cache/exchange/record-selection';
import { createNoopCacheHost } from '../../../graphql-cache/host/noop-host';
import type {
  CacheChangeListener,
  CacheHost,
} from '../../../graphql-cache/host/types';
import {
  type CacheChangeHints,
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
    reject: (cause: Error) => void;
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
        : new Promise((resolve, reject) =>
            requests.push({ args, resolve, reject })
          );
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
    change: (rev: string, changes?: CacheChangeHints) =>
      listeners.forEach((cb) => cb(revision(rev), changes)),
  };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

it('replaces only the patched row, sharing what the patch left', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  const rows = state.query.data()!.records;
  const [first, second] = rows;
  state.change('2');
  expect(state.requests[1].args.liveQuery?.since).toBe('1');
  state.requests[1].resolve(patch());
  await flush();
  const next = state.query.data()!.records;
  expect(next).not.toBe(rows);
  expect(next[0]).not.toBe(first);
  expect(next[0].record).toMatchObject({ id: 'a', read: true });
  expect(first.record).toMatchObject({ read: false });
  expect((next[0].record as { nested: object }).nested).toBe(
    (first.record as { nested: object }).nested
  );
  expect(next[1]).toBe(second);
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

it('stops stale-read retries without publishing stale rows and recovers on the next change', async () => {
  const state = setup();
  state.change('2');
  for (let index = 0; index < 3; index++) {
    state.requests[index].resolve(snapshot());
    await flush();
  }
  expect(state.query.status()).toBe('error');
  expect(state.query.error()).toBeInstanceOf(Error);
  expect(state.query.data()).toBeUndefined();
  expect(state.requests).toHaveLength(3);

  state.change('3');
  expect(state.requests).toHaveLength(4);
  state.requests[3].resolve({ ...snapshot(), revision: revision('3') });
  await flush();
  expect(state.query.status()).toBe('ready');
  expect(state.query.error()).toBeUndefined();
  expect(state.query.data()?.revision).toBe('3');
});

it('defers a cache change received during the last stale read instead of dropping it', async () => {
  vi.useFakeTimers();
  try {
    const state = setup();
    state.change('2');
    for (let index = 0; index < 2; index++) {
      state.requests[index].resolve(snapshot());
      await flush();
    }
    state.change('3');
    state.requests[2].resolve(snapshot());
    await flush();
    expect(state.query.status()).toBe('error');
    expect(state.requests).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(0);
    expect(state.requests).toHaveLength(4);
    state.requests[3].resolve({ ...snapshot(), revision: revision('3') });
    await flush();
    expect(state.query.status()).toBe('ready');
    expect(state.query.data()?.revision).toBe('3');
    state.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it('resets the stale-read budget when an old-generation request rejects', async () => {
  const state = setup();
  state.change('2');
  for (let index = 0; index < 2; index++) {
    state.requests[index].resolve(snapshot());
    await flush();
  }
  state.generations.forEach((callback) =>
    callback({ storage: 'reset', queue: 'reset' })
  );
  state.requests[2].reject(new Error('old generation closed'));
  await flush();
  state.change('2');
  state.requests[3].resolve(snapshot());
  await flush();
  expect(state.query.status()).toBe('loading');
  expect(state.requests).toHaveLength(5);
  state.requests[4].resolve({ ...snapshot(), revision: revision('2') });
  await flush();
  expect(state.query.status()).toBe('ready');
  expect(state.query.data()?.revision).toBe('2');
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
  state.generations.forEach((callback) =>
    callback({ storage: 'reset', queue: 'reset' })
  );
  expect(state.requests).toHaveLength(2);
});

it('discards old-generation reads and restarts without a cursor', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  state.change('2');
  state.generations.forEach((callback) =>
    callback({ storage: 'reset', queue: 'reset' })
  );
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

it('does not create root performance spans for repeated cache evaluations', async () => {
  const span = vi.spyOn(Telemetry, 'span');
  try {
    const state = setup();
    state.requests[0].resolve(snapshot());
    await flush();
    for (let index = 1; index <= 100; index++) {
      state.query.refresh();
      state.requests[index].resolve(patch(String(index + 1)));
      await flush();
    }
    expect(state.query.data()?.revision).toBe('101');
    expect(span).not.toHaveBeenCalledWith('urql.reconcile', {
      sampling: 'perf',
    });
  } finally {
    span.mockRestore();
  }
});

it('does not read on cache changes while hidden, then catches up once', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  try {
    const state = setup();
    state.requests[0].resolve(snapshot());
    await flush();

    visibility.mockReturnValue('hidden');
    state.change('2');
    state.change('3');
    state.generations.forEach((cb) =>
      cb({ storage: 'preserved', queue: 'preserved' })
    );
    expect(state.requests).toHaveLength(1);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state.requests).toHaveLength(2);
    expect(state.requests[1].args.liveQuery?.since).toBeUndefined();
  } finally {
    visibility.mockRestore();
  }
});

it('skips entityFilter reads when cache-change hints prove the observation unchanged', async () => {
  const state = setup();
  state.requests[0].resolve({ ...snapshot(), observationId: 'obs-1' });
  await flush();

  state.change('2', { unchangedViews: ['obs-1'] });
  expect(state.requests).toHaveLength(1);

  state.change('3', { unchangedViews: ['other-view'] });
  expect(state.requests).toHaveLength(2);
  state.requests[1].resolve({ ...patch('3'), observationId: 'obs-2' });
  await flush();

  state.change('4', { unchangedViews: ['obs-2'] });
  expect(state.requests).toHaveLength(2);

  // A generation reset clears the observation proof; later hints must not suppress reads.
  state.generations.forEach((cb) => cb({ storage: 'reset', queue: 'reset' }));
  expect(state.requests).toHaveLength(3);
  state.requests[2].resolve({ ...snapshot(), revision: revision('5') });
  await flush();
  state.change('6', { unchangedViews: ['obs-2'] });
  expect(state.requests).toHaveLength(4);
});

it('does not read again for a change the running read already reached', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  state.change('2');
  expect(state.requests).toHaveLength(2);
  // The write lands before the read runs: the reply is at its revision.
  state.change('3');
  state.requests[1].resolve(patch('3'));
  await flush();
  expect(state.query.data()?.revision).toBe('3');
  expect(state.requests).toHaveLength(2);
});

it('reads again for a change seen during a read that fails', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  state.change('2');
  state.change('3');
  state.requests[1].reject(new Error('owner gone'));
  await flush();
  expect(state.requests).toHaveLength(3);
  state.requests[2].resolve(patch('3'));
  await flush();
  expect(state.query.status()).toBe('ready');
  expect(state.query.data()?.revision).toBe('3');
});

it('reads again when an older change arrives after a newer one during a read', async () => {
  const state = setup();
  state.requests[0].resolve(snapshot());
  await flush();
  state.change('2');
  expect(state.requests).toHaveLength(2);
  // A write's and a hydration's notifications can cross on their way here.
  state.change('3');
  state.change('2');
  state.requests[1].resolve(patch('2'));
  await flush();
  expect(state.requests).toHaveLength(3);
  state.requests[2].resolve(patch('3'));
  await flush();
  expect(state.query.data()?.revision).toBe('3');
});

it('waits for the tab to show before reading again after a failed read', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  try {
    const state = setup();
    state.requests[0].resolve(snapshot());
    await flush();
    state.change('2');
    visibility.mockReturnValue('hidden');
    state.change('3');
    state.requests[1].reject(new Error('owner gone'));
    await flush();
    expect(state.requests).toHaveLength(2);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state.requests).toHaveLength(3);
    state.requests[2].resolve(patch('3'));
    await flush();
    expect(state.query.data()?.revision).toBe('3');
  } finally {
    visibility.mockRestore();
  }
});

it('reads a shaped view afresh when the host stops shaping its rows', async () => {
  // A native binary without the rows command turns `liveQueryRows` off once;
  // its next reply is a delta against selected records, not shaped rows. A
  // reply says whether it is shaped, whatever the host says by then.
  let shapes = true;
  const listeners = new Set<CacheChangeListener>();
  const requests: Array<{
    args: EntityFilterCacheArgs;
    resolve: (value: EntityFilterCacheResult) => void;
  }> = [];
  const host: CacheHost = {
    ...createNoopCacheHost(),
    get liveQueryRows() {
      return shapes;
    },
    onCacheChanged: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    entityFilter: (args) =>
      args.liveQuery?.release
        ? Promise.resolve({ kind: 'unsupported' })
        : new Promise((resolve) => requests.push({ args, resolve })),
  };
  const query = createRoot((dispose) => {
    cleanups.push(dispose);
    return createPredicateQuery({
      host: () => host,
      query: () => ({
        ...request,
        row: {
          name: 'channel-list' as const,
          toRow: (record: object, shaped: boolean) =>
            ({ ...record, shaped }) as unknown as Row,
        },
      }),
    });
  });
  const shapedOf = () =>
    query
      .data()
      ?.records.map(
        (row) => (row.record as unknown as { shaped: boolean }).shaped
      );
  expect(requests[0].args.liveQuery?.row).toBe('channel-list');
  // The host turns off while the shaped read is in flight.
  shapes = false;
  requests[0].resolve({ ...snapshot(), row: 'channel-list' });
  await flush();
  expect(shapedOf()).toEqual([true, true]);
  shapes = true;

  listeners.forEach((cb) => cb(revision('2')));
  await flush();
  expect(requests).toHaveLength(2);
  expect(requests[1].args.liveQuery?.since).toBe('1');
  shapes = false;
  requests[1].resolve(patch());
  await flush();

  expect(requests).toHaveLength(3);
  expect(requests[2].args.liveQuery?.since).toBeUndefined();
  expect(requests[2].args.liveQuery?.row).toBeUndefined();
  // The delta was not applied over rows of the other shape.
  expect(shapedOf()).toEqual([true, true]);
  requests[2].resolve({ ...snapshot(), revision: revision('2') });
  await flush();
  expect(shapedOf()).toEqual([false, false]);
});
