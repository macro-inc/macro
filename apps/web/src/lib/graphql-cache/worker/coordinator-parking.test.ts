import { expect, it } from 'vitest';
import { CoordinatorCore } from './coordinator-core';

function ready(core: CoordinatorCore, tabId: string, ownerEpoch: number) {
  core.beginOwnerLockWait(tabId, ownerEpoch);
  core.beginEngineOpen(tabId, ownerEpoch);
  return core.engineReady({
    tabId,
    ownerEpoch,
    ownerLockName: 'lock',
    expectedOwnerLockName: 'lock',
    ownerLockHeld: true,
    databaseActionProof: 'opened-existing',
    openOutcome: 'opened-existing',
  });
}

it('parks a hidden first registration without opening storage and wakes only on visibility', () => {
  const core = new CoordinatorCore('scope');
  expect(core.registerTab('a', false)).toEqual([]);
  expect(core.state).toEqual({
    kind: 'parked',
    nextDatabaseAction: 'open-existing',
  });
  expect(core.snapshot().ownerEpoch).toBe(0);
  expect(core.request('a', { id: 1, kind: 'init', scope: 'scope' })).toEqual(
    []
  );
  expect(core.registerTab('b', false)).toEqual([]);
  expect(core.setTabVisibility('a', false)).toEqual([]);
  expect(core.setTabVisibility('b', true)).toEqual([
    {
      kind: 'elect-owner',
      tabId: 'b',
      ownerEpoch: 1,
      databaseAction: 'open-existing',
    },
  ]);
  expect(ready(core, 'b', 1)).toMatchObject([
    { kind: 'route-request', requesterTabId: 'a', request: { kind: 'init' } },
  ]);
});

it('closes on last-visible exit, keeps clients, and routes an old settlement before a new claim', () => {
  const core = new CoordinatorCore('scope');
  core.registerTab('a');
  ready(core, 'a', 1);
  core.registerTab('b', false);
  core.setTabVisibility('a', false);
  expect(core.state.kind).toBe('draining');
  expect(core.engineDrained('a', 1)).toEqual([
    { kind: 'close-engine-route', tabId: 'a', ownerEpoch: 1 },
    { kind: 'release-owner', tabId: 'a', ownerEpoch: 1 },
  ]);
  expect(core.state).toEqual({
    kind: 'parked',
    nextDatabaseAction: 'open-existing',
  });
  expect(core.snapshot().tabIds).toEqual(['a', 'b']);
  expect(
    core.request('a', {
      id: 3,
      kind: 'commit-optimistic-write',
      transactionId: '1',
      leaseOwner: 'a',
      leaseGeneration: '1',
      query: 'mutation Saved { saved }',
      data: { saved: true },
    })
  ).toEqual([]);
  expect(core.request('b', { id: 4, kind: 'current-revision' })).toEqual([]);
  expect(core.setTabVisibility('b', true)).toEqual([
    {
      kind: 'elect-owner',
      tabId: 'b',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    },
  ]);
  expect(
    core.request('b', {
      id: 5,
      kind: 'claim-next-mutation',
      owner: 'b',
      nowMs: 600_000,
      leaseExpiresAtMs: 900_000,
    })
  ).toEqual([]);
  const actions = ready(core, 'b', 2);
  expect(
    actions
      .filter((action) => action.kind === 'route-request')
      .map((action) => action.request.kind)
  ).toEqual([
    'commit-optimistic-write',
    'current-revision',
    'claim-next-mutation',
  ]);
  expect(core.snapshot().queuedRequestCount).toBe(0);
});

it('retains an accepted settlement after its caller leaves, without retaining abandoned reads', () => {
  const core = new CoordinatorCore('scope');
  core.registerTab('a');
  ready(core, 'a', 1);
  core.registerTab('b', false);
  core.setTabVisibility('a', false);
  core.engineDrained('a', 1);
  core.request('a', {
    id: 7,
    kind: 'commit-optimistic-write',
    transactionId: '1',
    leaseOwner: 'a',
    leaseGeneration: '1',
    query: 'mutation Saved { saved }',
    data: { saved: true },
  });
  core.request('a', { id: 8, kind: 'current-revision' });
  core.tabLost('a');
  expect(core.snapshot().queuedRequestCount).toBe(1);
  core.setTabVisibility('b', true);
  const routes = ready(core, 'b', 2).filter(
    (action) => action.kind === 'route-request'
  );
  expect(routes).toHaveLength(1);
  const route = routes[0];
  if (!route) throw new Error('missing retained settlement');
  expect(route.request.kind).toBe('commit-optimistic-write');
  expect(
    core.engineResponse(2, route.routeId, {
      id: route.routeId,
      ok: true,
      result: null,
    })
  ).toEqual([]);
  expect(core.snapshot().inFlightRequestCount).toBe(0);
});

it('does not cancel a storage open on hide and parks only after its drain acknowledgement', () => {
  const core = new CoordinatorCore('scope');
  core.registerTab('a');
  core.beginOwnerLockWait('a', 1);
  core.beginEngineOpen('a', 1);
  expect(core.setTabVisibility('a', false)).toEqual([
    { kind: 'handoff-pending', ownerEpoch: 1 },
  ]);
  expect(core.state).toMatchObject({
    kind: 'activating',
    phase: 'opening-database',
  });
  const actions = core.engineReady({
    tabId: 'a',
    ownerEpoch: 1,
    ownerLockName: 'lock',
    expectedOwnerLockName: 'lock',
    ownerLockHeld: true,
    databaseActionProof: 'opened-existing',
    openOutcome: 'opened-existing',
  });
  expect(actions).toEqual([
    { kind: 'drain-owner', tabId: 'a', ownerEpoch: 1, handoff: true },
  ]);
  expect(core.snapshot().ownerEpoch).toBe(1);
  core.engineDrained('a', 1);
  expect(core.state.kind).toBe('parked');
});

it('retains a real abrupt-loss reset requirement through all-hidden recovery', () => {
  const core = new CoordinatorCore('scope');
  core.registerTab('a');
  ready(core, 'a', 1);
  core.setTabVisibility('a', false);
  core.ownerLost('a', 1, 'runtime failure');
  expect(core.resumeAfterLoss()).toEqual([]);
  expect(core.state).toEqual({
    kind: 'parked',
    nextDatabaseAction: 'wipe-before-open',
  });
  expect(core.setTabVisibility('a', true)).toEqual([
    {
      kind: 'elect-owner',
      tabId: 'a',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    },
  ]);
});
