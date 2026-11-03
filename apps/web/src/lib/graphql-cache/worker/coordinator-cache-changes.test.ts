import { expect, it } from 'vitest';
import {
  type CachePush,
  type CacheRequest,
  parseCacheRevision,
} from '../protocol';
import { CoordinatorCore } from './coordinator-core';
import type { EngineOpenOutcome } from './coordinator-protocol';

function ready(
  core: CoordinatorCore,
  tabId: string,
  ownerEpoch: number,
  openOutcome: EngineOpenOutcome = 'opened-existing'
) {
  core.beginOwnerLockWait(tabId, ownerEpoch);
  core.beginEngineOpen(tabId, ownerEpoch);
  return core.engineReady({
    tabId,
    ownerEpoch,
    ownerLockName: 'lock',
    expectedOwnerLockName: 'lock',
    ownerLockHeld: true,
    databaseActionProof: openOutcome.startsWith('reset-')
      ? 'wiped-before-open'
      : 'opened-existing',
    openOutcome,
  });
}

function resume(requests: CacheRequest[]) {
  const core = new CoordinatorCore('synthetic');
  core.registerTab('a');
  ready(core, 'a', 1);
  core.setTabVisibility('a', false);
  core.engineDrained('a', 1);
  expect(core.state.kind).toBe('parked');
  for (const request of requests)
    expect(core.request('a', request)).toEqual([]);
  core.setTabVisibility('a', true);
  const routes = ready(core, 'a', 2).filter(
    (action) => action.kind === 'route-request'
  );
  expect(routes).toHaveLength(requests.length);
  return {
    core,
    routes,
    push: (push: CachePush) => core.enginePush(2, push),
    reply: (index: number, ok = true) => {
      const route = routes[index];
      if (!route) throw new Error('missing route');
      return core.engineResponse(
        2,
        route.routeId,
        ok
          ? { id: route.routeId, ok: true, result: null }
          : { id: route.routeId, ok: false, error: 'write rejected' }
      );
    },
  };
}

it('announces the full resume backlog once, even when the engine executes each port message separately', () => {
  const names = [
    'SoupUpdates',
    'ChannelUnreadPresence',
    'CalendarChanges',
    'Calendars',
  ];
  const { push, reply } = resume([
    ...names.map(
      (operationName, index): CacheRequest => ({
        id: index + 1,
        kind: 'write',
        query: `query ${operationName} { value }`,
        data: { value: index },
      })
    ),
    { id: 5, kind: 'calendar-commit', commit: { freshness: 'fresh' } },
  ]);
  for (let index = 0; index < names.length; index += 1) {
    expect(
      push({
        kind: 'cache-changed',
        revision: parseCacheRevision(String(index + 1)),
        searchChangedBuckets: index === 0 ? ['note'] : ['calendar'],
      })
    ).toEqual([]);
    expect(reply(index)).toEqual([
      {
        kind: 'deliver-response',
        tabId: 'a',
        response: { id: index + 1, ok: true, result: null },
      },
    ]);
  }
  expect(
    push({
      kind: 'cache-changed',
      revision: parseCacheRevision('5'),
      searchChangedBuckets: [],
    })
  ).toEqual([
    {
      kind: 'broadcast-push',
      push: {
        kind: 'cache-changed',
        revision: '5',
        searchChangedBuckets: ['note', 'calendar'],
      },
      coalescedCount: 5,
    },
  ]);
  expect(reply(4)).toHaveLength(1);
});

it.each([true, false])(
  'flushes committed hints when the last request has no push (success: %s)',
  (ok) => {
    const { push, reply } = resume([
      { id: 1, kind: 'write', query: '{ value }', data: { value: 1 } },
      { id: 2, kind: 'read', query: '{ value }' },
    ]);
    expect(
      push({ kind: 'cache-changed', revision: parseCacheRevision('1') })
    ).toEqual([]);
    reply(0);
    expect(reply(1, ok)).toEqual([
      {
        kind: 'broadcast-push',
        push: { kind: 'cache-changed', revision: '1' },
      },
      {
        kind: 'deliver-response',
        tabId: 'a',
        response: ok
          ? { id: 2, ok: true, result: null }
          : { id: 2, ok: false, error: 'write rejected' },
      },
    ]);
  }
);

it('never delays dependency pushes or mutation settlements behind broad refreshes', () => {
  const { push } = resume([
    { id: 1, kind: 'write', query: '{ value }', data: { value: 1 } },
    { id: 2, kind: 'read', query: '{ value }' },
  ]);
  expect(
    push({ kind: 'cache-changed', revision: parseCacheRevision('1') })
  ).toEqual([]);
  const affected: CachePush = {
    kind: 'ops-affected',
    opIds: ['a:1'],
    keys: ['Record:1'],
  };
  const settled: CachePush = {
    kind: 'mutation-settled',
    settlement: {
      transactionId: '1',
      mutationUuid: 'synthetic',
      status: 'committed',
    },
  };
  expect(push(affected)).toEqual([{ kind: 'broadcast-push', push: affected }]);
  expect(push(settled)).toEqual([{ kind: 'broadcast-push', push: settled }]);
});

it('fences a reset immediately and never replays pre-reset revisions or scopes', () => {
  const { push, reply } = resume([
    { id: 1, kind: 'write', query: '{ value }', data: { value: 1 } },
    { id: 2, kind: 'clear' },
    { id: 3, kind: 'write', query: '{ value }', data: { value: 2 } },
  ]);
  push({
    kind: 'cache-changed',
    revision: parseCacheRevision('7'),
    searchChangedBuckets: ['note'],
  });
  reply(0);
  expect(
    push({
      kind: 'cache-changed',
      revision: parseCacheRevision('0'),
      reset: true,
    })
  ).toEqual([
    {
      kind: 'broadcast-push',
      push: { kind: 'cache-changed', revision: '0', reset: true },
    },
  ]);
  reply(1);
  expect(
    push({
      kind: 'cache-changed',
      revision: parseCacheRevision('1'),
      searchChangedBuckets: [],
    })
  ).toEqual([
    {
      kind: 'broadcast-push',
      push: { kind: 'cache-changed', revision: '1', searchChangedBuckets: [] },
    },
  ]);
  expect(reply(2)).toHaveLength(1);
});

it.each([
  { buckets: undefined, expected: undefined },
  { buckets: [], expected: ['note'] },
  { buckets: ['calendar', 'note'], expected: ['note', 'calendar'] },
])(
  'unions authoritative scopes without promoting hydration: $buckets',
  ({ buckets, expected }) => {
    const { push, reply } = resume([
      { id: 1, kind: 'write', query: '{ value }', data: { value: 1 } },
      { id: 2, kind: 'hydrate', query: '{ value }', data: { value: 2 } },
      { id: 3, kind: 'write', query: '{ value }', data: { value: 3 } },
    ]);
    push({
      kind: 'cache-changed',
      revision: parseCacheRevision('1'),
      searchChangedBuckets: ['note'],
    });
    reply(0);
    push({
      kind: 'cache-hydrated',
      revision: parseCacheRevision('2'),
      searchChangedBuckets: ['task'],
    });
    reply(1);
    expect(
      push({
        kind: 'cache-changed',
        revision: parseCacheRevision('3'),
        ...(buckets === undefined ? {} : { searchChangedBuckets: buckets }),
      })
    ).toEqual([
      {
        kind: 'broadcast-push',
        push: {
          kind: 'cache-hydrated',
          revision: '2',
          searchChangedBuckets: ['task'],
        },
      },
      {
        kind: 'broadcast-push',
        push: {
          kind: 'cache-changed',
          revision: '3',
          ...(expected === undefined ? {} : { searchChangedBuckets: expected }),
        },
        coalescedCount: 2,
      },
    ]);
  }
);

it('bounds refresh suppression while more requests remain in flight', () => {
  const { push, reply } = resume(
    Array.from({ length: 65 }, (_, index) => ({
      id: index + 1,
      kind: 'write',
      query: '{ value }',
      data: { value: index },
    }))
  );
  for (let index = 0; index < 64; index += 1) {
    expect(
      push({
        kind: 'cache-changed',
        revision: parseCacheRevision(String(index + 1)),
      })
    ).toEqual([]);
    const actions = reply(index);
    if (index < 63) expect(actions).toHaveLength(1);
    else
      expect(actions[0]).toEqual({
        kind: 'broadcast-push',
        push: { kind: 'cache-changed', revision: '64' },
        coalescedCount: 64,
      });
  }
  expect(
    push({ kind: 'cache-changed', revision: parseCacheRevision('65') })
  ).toEqual([
    { kind: 'broadcast-push', push: { kind: 'cache-changed', revision: '65' } },
  ]);
});

it('flushes accepted changes on owner loss and keeps the new epoch separate', () => {
  const { core, push } = resume([
    { id: 1, kind: 'write', query: '{ value }', data: { value: 1 } },
    { id: 2, kind: 'read', query: '{ value }' },
  ]);
  push({
    kind: 'cache-changed',
    revision: parseCacheRevision('7'),
    searchChangedBuckets: ['note'],
  });
  expect(core.ownerLost('a', 2, 'synthetic loss')[0]).toEqual({
    kind: 'broadcast-push',
    push: {
      kind: 'cache-changed',
      revision: '7',
      searchChangedBuckets: ['note'],
    },
  });
  core.resumeAfterLoss();
  ready(core, 'a', 3, 'reset-storage-uncertain');
  expect(
    core.enginePush(2, {
      kind: 'cache-changed',
      revision: parseCacheRevision('8'),
    })[0]
  ).toMatchObject({ kind: 'drop-stale-engine-message' });
  expect(
    core.enginePush(3, {
      kind: 'cache-changed',
      revision: parseCacheRevision('1'),
      searchChangedBuckets: [],
    })
  ).toEqual([
    {
      kind: 'broadcast-push',
      push: { kind: 'cache-changed', revision: '1', searchChangedBuckets: [] },
    },
  ]);
});

it('flushes when the last waiting caller leaves without waiting for its discarded reply', () => {
  const { core, push } = resume([]);
  core.registerTab('b');
  core.request('b', { id: 1, kind: 'read', query: '{ value }' });
  core.request('b', { id: 2, kind: 'read', query: '{ value }' });
  expect(
    push({ kind: 'cache-changed', revision: parseCacheRevision('1') })
  ).toEqual([]);
  expect(core.tabLost('b')).toContainEqual({
    kind: 'broadcast-push',
    push: { kind: 'cache-changed', revision: '1' },
  });
  expect(core.snapshot().inFlightRequestCount).toBe(0);
});

it('keeps ordinary single-request updates immediate', () => {
  const { push } = resume([
    { id: 1, kind: 'write', query: '{ value }', data: { value: 1 } },
  ]);
  expect(
    push({ kind: 'cache-changed', revision: parseCacheRevision('1') })
  ).toEqual([
    { kind: 'broadcast-push', push: { kind: 'cache-changed', revision: '1' } },
  ]);
});
