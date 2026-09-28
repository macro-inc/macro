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

/** Assets loaded, owner lock acquired, storage granted. */
const grantStorage = (
  core: CoordinatorCore,
  tabId: string,
  ownerEpoch: number
): void => {
  core.beginOwnerLockWait(tabId, ownerEpoch);
  core.beginEngineOpen(tabId, ownerEpoch);
};

const ready = (
  core: CoordinatorCore,
  tabId: string,
  ownerEpoch: number,
  databaseActionProof: DatabaseActionProof
): CoordinatorAction[] => {
  grantStorage(core, tabId, ownerEpoch);
  return core.engineReady({
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
};

const init = (id: number) => ({ id, kind: 'init', scope: 'scope' }) as const;

const clear = (id: number) => ({ id, kind: 'clear' }) as const;

describe('CoordinatorCore', () => {
  it('preserves storage when the engine is lost while trying the owner lock', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    expect(core.beginOwnerLockWait('tab-a', 1)).toBe(true);

    core.ownerLost('tab-a', 1, 'owner tab closed while the lock was busy');

    // Trying to take the lock cannot have changed OPFS.
    expect(action(core.resumeAfterLoss(), 'elect-owner').databaseAction).toBe(
      'open-existing'
    );
  });

  it('fails closed when another context keeps the owner lock', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    expect(core.request('tab-a', init(1))).toEqual([]);
    expect(core.request('tab-b', clear(2))).toEqual([]);
    core.beginOwnerLockWait('tab-a', 1);

    const actions = core.ownerLockUnavailable('tab-a', 1);

    const unavailable = {
      kind: 'reject-request',
      error: expect.stringContaining('owner lock is held'),
      errorCode: 'owner-lock-unavailable',
    };
    expect(actions).toEqual([
      { ...unavailable, tabId: 'tab-a', requestId: 1 },
      { ...unavailable, tabId: 'tab-b', requestId: 2 },
      { kind: 'close-engine-route', tabId: 'tab-a', ownerEpoch: 1 },
      {
        kind: 'broadcast-cache-unavailable',
        reason: expect.stringContaining('another app version'),
      },
    ]);
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    });
    // Tabs told to stay uncached are refused and never elected again.
    expect(core.request('tab-b', init(3))).toEqual([
      { ...unavailable, tabId: 'tab-b', requestId: 3 },
    ]);
    expect(core.ownerLockUnavailable('tab-a', 1)).toEqual([]);
    expect(action(core.registerTab('tab-c'), 'elect-owner')).toEqual({
      kind: 'elect-owner',
      tabId: 'tab-c',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
    expect(core.request('tab-c', init(4))).toEqual([]);
  });

  it('never fails closed once storage may have been touched', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    grantStorage(core, 'tab-a', 1);

    expect(core.ownerLockUnavailable('tab-a', 1)).toEqual([]);
    expect(core.state).toMatchObject({
      kind: 'activating',
      phase: 'opening-database',
    });
  });

  it('keeps a pending recovery wipe for the attempt after failing closed', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.tabLost('tab-a');
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      databaseAction: 'wipe-before-open',
    });
    core.beginOwnerLockWait('tab-b', 2);

    core.ownerLockUnavailable('tab-b', 2);

    expect(action(core.registerTab('tab-c'), 'elect-owner')).toMatchObject({
      tabId: 'tab-c',
      databaseAction: 'wipe-before-open',
    });
  });

  it('fails closed without a wipe when the database files stay busy', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    expect(core.request('tab-b', init(1))).toEqual([]);
    // Only an engine granted storage can find the files busy.
    expect(core.storageBusy('tab-a', 1)).toEqual([]);
    grantStorage(core, 'tab-a', 1);

    const actions = core.storageBusy('tab-a', 1);

    const unavailable = {
      kind: 'reject-request',
      error: expect.stringContaining('files are still open'),
      errorCode: 'owner-lock-unavailable',
    };
    expect(actions).toEqual([
      { ...unavailable, tabId: 'tab-b', requestId: 1 },
      { kind: 'close-engine-route', tabId: 'tab-a', ownerEpoch: 1 },
      {
        kind: 'broadcast-cache-unavailable',
        reason: expect.stringContaining('files are still open'),
      },
    ]);
    // The open changed nothing, so no attempt is scheduled to repair it.
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    });
    expect(core.request('tab-a', init(2))).toEqual([
      { ...unavailable, tabId: 'tab-a', requestId: 2 },
    ]);
    expect(core.storageBusy('tab-a', 1)).toEqual([]);
    expect(action(core.registerTab('tab-c'), 'elect-owner')).toEqual({
      kind: 'elect-owner',
      tabId: 'tab-c',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
  });

  it('keeps a pending recovery wipe when its files stay busy', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.tabLost('tab-a');
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      databaseAction: 'wipe-before-open',
    });
    grantStorage(core, 'tab-b', 2);

    core.storageBusy('tab-b', 2);

    expect(action(core.registerTab('tab-c'), 'elect-owner')).toMatchObject({
      tabId: 'tab-c',
      databaseAction: 'wipe-before-open',
    });
  });

  it('preserves storage after bootstrap loss but requires recovery once opening was granted', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.ownerLost('tab-a', 1, 'asset timeout');
    expect(action(core.resumeAfterLoss(), 'elect-owner').databaseAction).toBe(
      'open-existing'
    );
    expect(core.beginOwnerLockWait('tab-a', 1)).toBe(false);
    // Storage is granted only once the engine holds the owner lock.
    expect(core.beginEngineOpen('tab-a', 2)).toBe(false);
    expect(core.beginOwnerLockWait('tab-a', 2)).toBe(true);
    expect(core.beginEngineOpen('tab-a', 2)).toBe(true);
    expect(core.beginEngineOpen('tab-a', 2)).toBe(false);
    core.ownerLost('tab-a', 2, 'database open timeout');
    expect(action(core.resumeAfterLoss(), 'elect-owner').databaseAction).toBe(
      'wipe-before-open'
    );
    // Failing to load assets during recovery must not erase a prior reset requirement.
    core.ownerLost('tab-a', 3, 'asset download failed');
    expect(action(core.resumeAfterLoss(), 'elect-owner').databaseAction).toBe(
      'wipe-before-open'
    );
  });

  it('preserves storage when the only tab closes before the open grant', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.tabLost('tab-a');
    core.resumeAfterLoss();
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    });
    expect(
      action(core.registerTab('tab-b'), 'elect-owner').databaseAction
    ).toBe('open-existing');
  });

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
      openOutcome: 'opened-existing',
    });
  });

  it.each([
    'opened-existing',
    'opened-new',
    'reset-incompatible',
    'reset-corrupt',
    'reset-storage-uncertain',
  ] as const)(
    'reports actual %s storage outcome, not the requested open action',
    (openOutcome) => {
      const core = new CoordinatorCore('scope');
      core.registerTab('tab-a');
      core.registerTab('tab-b');
      ready(core, 'tab-a', 1, 'opened-existing');
      core.beginGracefulDeparture('tab-a', 1);
      const handoff = core.engineDrained('tab-a', 1);
      expect(action(handoff, 'elect-owner').databaseAction).toBe(
        'open-existing'
      );
      grantStorage(core, 'tab-b', 2);
      const actions = core.engineReady({
        tabId: 'tab-b',
        ownerEpoch: 2,
        ownerLockName: OWNER_LOCK,
        expectedOwnerLockName: OWNER_LOCK,
        ownerLockHeld: true,
        databaseActionProof: openOutcome.startsWith('reset-')
          ? 'wiped-before-open'
          : 'opened-existing',
        openOutcome,
      });
      expect(action(actions, 'broadcast-engine-replaced')).toEqual({
        kind: 'broadcast-engine-replaced',
        ownerEpoch: 2,
        openOutcome,
      });
    }
  );

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
      databaseAction: 'wipe-before-open',
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
      openOutcome: 'reset-storage-uncertain',
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

    grantStorage(core, 'tab-a', 1);
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
    grantStorage(core, 'tab-b', 2);
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

  it('makes retry exhaustion terminal for current and future tabs', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.ownerLost('tab-a', 1, 'OPFS recovery failed');
    core.request('tab-b', { id: 7, kind: 'clear' });

    expect(core.terminalFailure('cache recovery exhausted')).toEqual([
      { kind: 'terminal-failure', error: 'cache recovery exhausted' },
    ]);
    expect(core.state).toEqual({
      kind: 'failed',
      reason: 'cache recovery exhausted',
    });
    expect(core.snapshot().queuedRequestCount).toBe(0);
    expect(core.request('tab-b', { id: 8, kind: 'clear' })).toEqual([
      {
        kind: 'reject-request',
        tabId: 'tab-b',
        requestId: 8,
        error: 'cache recovery exhausted',
      },
    ]);
    expect(core.registerTab('tab-c')).toEqual([
      { kind: 'terminal-failure', error: 'cache recovery exhausted' },
    ]);
    expect(core.resumeAfterLoss()).toEqual([]);
  });
});
