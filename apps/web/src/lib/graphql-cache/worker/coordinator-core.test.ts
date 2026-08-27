import { describe, expect, it } from 'vitest';
import { INITIAL_CACHE_REVISION } from '../protocol';
import { type CoordinatorAction, CoordinatorCore } from './coordinator-core';
import type { DatabaseActionProof } from './coordinator-protocol';

const OWNER_LOCK = 'physical-owner-lock';

const action = <K extends CoordinatorAction['kind']>(
  actions: CoordinatorAction[],
  kind: K
): Extract<CoordinatorAction, { kind: K }> => {
  const found = actions.find((candidate) => candidate.kind === kind);
  if (!found) throw new Error(`missing ${kind}`);
  return found as Extract<CoordinatorAction, { kind: K }>;
};

const ready = (
  core: CoordinatorCore,
  tabId: string,
  ownerEpoch: number,
  databaseActionProof: DatabaseActionProof
): CoordinatorAction[] =>
  core.engineReady({
    tabId,
    ownerEpoch,
    ownerLockName: OWNER_LOCK,
    expectedOwnerLockName: OWNER_LOCK,
    ownerLockHeld: true,
    databaseActionProof,
    openOutcome:
      databaseActionProof === 'wiped-before-open'
        ? 'reset-storage-uncertain'
        : 'opened-existing',
  });

const init = (id: number) => ({ id, kind: 'init', scope: 'scope' }) as const;

const clear = (id: number) => ({ id, kind: 'clear' }) as const;

describe('CoordinatorCore', () => {
  it('covers waiting, activating, active, draining, and graceful reactivation', () => {
    const core = new CoordinatorCore('scope');
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    });

    expect(core.registerTab('tab-a')).toEqual([
      {
        kind: 'elect-owner',
        tabId: 'tab-a',
        ownerEpoch: 1,
        databaseAction: 'open-existing',
      },
    ]);
    core.registerTab('tab-b');
    core.registerTab('tab-c');
    expect(core.snapshot()).toMatchObject({
      state: { kind: 'activating', tabId: 'tab-a', ownerEpoch: 1 },
      activeOwnerCount: 0,
      tabIds: ['tab-a', 'tab-b', 'tab-c'],
    });

    core.request('tab-c', init(1));
    expect(core.snapshot().queuedRequestCount).toBe(1);
    const activation = ready(core, 'tab-a', 1, 'opened-existing');
    expect(action(activation, 'route-request')).toMatchObject({
      requesterTabId: 'tab-c',
      ownerTabId: 'tab-a',
      ownerEpoch: 1,
      request: { id: 1, kind: 'init' },
    });
    expect(core.snapshot().activeOwnerCount).toBe(1);

    expect(core.beginGracefulDeparture('tab-a', 1)).toEqual([
      { kind: 'drain-owner', tabId: 'tab-a', ownerEpoch: 1 },
    ]);
    expect(core.state.kind).toBe('draining');
    const handoff = core.engineDrained('tab-a', 1);
    expect(action(handoff, 'retire-tab')).toEqual({
      kind: 'retire-tab',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    expect(action(handoff, 'elect-owner')).toEqual({
      kind: 'elect-owner',
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
    expect(ready(core, 'tab-b', 2, 'opened-existing')).toContainEqual({
      kind: 'broadcast-engine-replaced',
      ownerEpoch: 2,
    });
  });

  it('rejects unregistered and retiring-tab requests', () => {
    const core = new CoordinatorCore('scope');
    expect(core.request('missing', clear(1))).toEqual([
      expect.objectContaining({
        kind: 'reject-request',
        tabId: 'missing',
        requestId: 1,
        error: 'requester tab is not registered',
      }),
    ]);

    core.registerTab('tab-a');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.beginGracefulDeparture('tab-a', 1);
    expect(core.request('tab-a', clear(2))).toEqual([
      expect.objectContaining({
        kind: 'reject-request',
        tabId: 'tab-a',
        requestId: 2,
        error: 'requester tab is retiring',
      }),
    ]);
  });

  it('rewrites colliding per-tab request ids into unique routes and restores them', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    core.registerTab('tab-c');
    ready(core, 'tab-a', 1, 'opened-existing');

    const first = action(core.request('tab-b', clear(7)), 'route-request');
    const second = action(core.request('tab-c', clear(7)), 'route-request');
    expect(first.routeId).not.toBe(second.routeId);
    expect(first.request.id).toBe(first.routeId);
    expect(second.request.id).toBe(second.routeId);

    expect(
      core.engineResponse(1, second.routeId, {
        id: second.routeId,
        ok: true,
        result: 'second',
      })
    ).toEqual([
      {
        kind: 'deliver-response',
        tabId: 'tab-c',
        response: { id: 7, ok: true, result: 'second' },
      },
    ]);
    expect(
      core.engineResponse(1, first.routeId, {
        id: first.routeId,
        ok: true,
        result: 'first',
      })
    ).toEqual([
      {
        kind: 'deliver-response',
        tabId: 'tab-b',
        response: { id: 7, ok: true, result: 'first' },
      },
    ]);
  });

  it('continues routing earlier responses and pushes while draining, then queues later work', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    const routed = action(core.request('tab-b', clear(4)), 'route-request');

    core.beginGracefulDeparture('tab-a', 1);
    expect(core.request('tab-b', clear(5))).toEqual([]);
    expect(core.snapshot().queuedRequestCount).toBe(1);
    expect(
      core.enginePush(1, {
        kind: 'cache-changed',
        revision: INITIAL_CACHE_REVISION,
      })
    ).toEqual([
      {
        kind: 'broadcast-push',
        push: { kind: 'cache-changed', revision: INITIAL_CACHE_REVISION },
      },
    ]);
    expect(
      core.engineResponse(1, routed.routeId, {
        id: routed.routeId,
        ok: true,
        result: null,
      })
    ).toContainEqual({
      kind: 'deliver-response',
      tabId: 'tab-b',
      response: { id: 4, ok: true, result: null },
    });

    core.engineDrained('tab-a', 1);
    const activation = ready(core, 'tab-b', 2, 'opened-existing');
    expect(action(activation, 'route-request')).toMatchObject({
      requesterTabId: 'tab-b',
      ownerEpoch: 2,
      request: { kind: 'clear' },
    });
  });

  it('rejects old-epoch inflight work without replay and requires wipe proof', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    const old = action(core.request('tab-b', clear(9)), 'route-request');

    const loss = core.ownerLost('tab-a', 1, 'worker failed');
    expect(loss).toContainEqual({
      kind: 'reject-request',
      tabId: 'tab-b',
      requestId: 9,
      error: 'owner epoch 1 was lost: worker failed',
      errorCode: 'owner-epoch-lost',
    });
    expect(core.state).toEqual({
      kind: 'resetting-after-loss',
      previousTabId: 'tab-a',
      previousEpoch: 1,
      nextEpoch: 2,
      reason: 'worker failed',
    });
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
    expect(ready(core, 'tab-b', 2, 'wiped-before-open')).toContainEqual({
      kind: 'broadcast-engine-replaced',
      ownerEpoch: 2,
    });

    expect(
      core.engineResponse(1, old.routeId, {
        id: old.routeId,
        ok: true,
        result: 'stale',
      })
    ).toEqual([
      {
        kind: 'drop-stale-engine-message',
        ownerEpoch: 1,
        routeId: old.routeId,
        reason: 'stale-epoch',
      },
    ]);
    expect(core.snapshot().staleMessageDrops).toBe(1);
  });

  it('drops unknown current routes and old-epoch pushes', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    ready(core, 'tab-a', 1, 'opened-existing');

    expect(
      core.engineResponse(1, 77, { id: 77, ok: true, result: null })
    ).toContainEqual(
      expect.objectContaining({
        kind: 'drop-stale-engine-message',
        reason: 'unknown-route',
      })
    );
    expect(
      core.enginePush(0, {
        kind: 'cache-changed',
        revision: INITIAL_CACHE_REVISION,
      })
    ).toContainEqual(
      expect.objectContaining({
        kind: 'drop-stale-engine-message',
        reason: 'stale-epoch',
      })
    );
  });

  it('preserves storage across an intentional navigation departure', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.request('tab-b', clear(9));

    const departure = core.departForNavigation('tab-a', 1, 'page navigation');
    expect(departure).toContainEqual({
      kind: 'reject-request',
      tabId: 'tab-b',
      requestId: 9,
      error: 'owner epoch 1 departed for navigation: page navigation',
      errorCode: 'owner-epoch-lost',
    });
    expect(action(departure, 'elect-owner')).toEqual({
      kind: 'elect-owner',
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
  });

  it('does not downgrade an interrupted recovery activation to open-existing', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.ownerLost('tab-a', 1, 'engine failed');
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });

    expect(
      action(
        core.departForNavigation('tab-b', 2, 'recovery owner navigated'),
        'elect-owner'
      )
    ).toEqual({
      kind: 'elect-owner',
      tabId: 'tab-a',
      ownerEpoch: 3,
      databaseAction: 'wipe-before-open',
    });
  });

  it('retains open-existing when a navigating owner has no standby', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    ready(core, 'tab-a', 1, 'opened-existing');

    expect(core.departForNavigation('tab-a', 1, 'refresh')).toEqual([
      { kind: 'close-engine-route', tabId: 'tab-a', ownerEpoch: 1 },
      { kind: 'drop-tab', tabId: 'tab-a' },
    ]);
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    });
    expect(core.registerTab('tab-b')).toEqual([
      {
        kind: 'elect-owner',
        tabId: 'tab-b',
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      },
    ]);
  });

  it('uses standby liveness loss without failover and owner liveness loss with wipe', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    core.registerTab('tab-c');
    ready(core, 'tab-a', 1, 'opened-existing');

    expect(core.tabLost('tab-c')).toEqual([
      { kind: 'drop-tab', tabId: 'tab-c' },
    ]);
    expect(core.state).toEqual({
      kind: 'active',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    expect(core.tabLost('tab-a')).toContainEqual({
      kind: 'schedule-reset-activation',
    });
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
  });

  it('rejects wrong physical-lock and reset proofs without activating', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');

    const wrongLock = core.engineReady({
      tabId: 'tab-a',
      ownerEpoch: 1,
      ownerLockName: 'wrong',
      expectedOwnerLockName: OWNER_LOCK,
      ownerLockHeld: true,
      databaseActionProof: 'opened-existing',
      openOutcome: 'opened-existing',
    });
    expect(action(wrongLock, 'protocol-violation').error).toContain(
      'wrong physical owner lock'
    );
    core.resumeAfterLoss();
    const wrongProof = core.engineReady({
      tabId: 'tab-b',
      ownerEpoch: 2,
      ownerLockName: OWNER_LOCK,
      expectedOwnerLockName: OWNER_LOCK,
      ownerLockHeld: true,
      databaseActionProof: 'opened-existing',
      openOutcome: 'reset-storage-uncertain',
    });
    expect(action(wrongProof, 'protocol-violation').error).toContain(
      'does not match open outcome'
    );
    expect(core.snapshot().activeOwnerCount).toBe(0);
  });

  it('retains wipe-before-open while no replacement tab is available', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.tabLost('tab-a');
    expect(core.resumeAfterLoss()).toEqual([]);
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'wipe-before-open',
    });
    expect(core.registerTab('tab-b')).toEqual([
      {
        kind: 'elect-owner',
        tabId: 'tab-b',
        ownerEpoch: 2,
        databaseAction: 'wipe-before-open',
      },
    ]);
  });
});
