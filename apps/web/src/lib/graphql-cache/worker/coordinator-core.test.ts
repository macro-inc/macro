import { match } from 'ts-pattern';
import { describe, expect, it } from 'vitest';
import { type CacheRequest, INITIAL_CACHE_REVISION } from '../protocol';
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

const rollback = (id: number): CacheRequest => ({
  id,
  kind: 'rollback-optimistic-write',
  transactionId: '1',
  leaseOwner: 'tab-b',
  leaseGeneration: '1',
  error: 'refused by the server',
});

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

  it('hands a new engine the held typed search before the reads replayed around a restart, never past a clear', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    const search = (id: number, query: string): CacheRequest => ({
      id,
      kind: 'search',
      request: {
        profile: 'quick-access-v1',
        buckets: ['document'],
        query,
        limit: 20,
        nowMs: 1,
      },
    });
    const held: CacheRequest[] = [
      {
        id: 1,
        kind: 'hydrate',
        query: 'query Backfill { backfill }',
        data: { backfill: true },
      },
      {
        id: 2,
        kind: 'read',
        query: 'query List { list }',
        priority: 'user-visible',
      },
      search(3, ''),
      search(4, 'todo'),
      clear(5),
      search(6, 'after clear'),
    ];
    for (const request of held) {
      expect(core.request('tab-a', request)).toEqual([]);
    }

    const routed = ready(core, 'tab-a', 1, 'opened-existing')
      .filter((candidate) => candidate.kind === 'route-request')
      .map(({ request }) =>
        request.kind === 'search'
          ? `search:${request.request.query}`
          : request.kind
      );

    expect(routed).toEqual([
      'search:todo',
      'hydrate',
      'read',
      'search:',
      'clear',
      'search:after clear',
    ]);
  });

  it('goes on trying, and refuses work meanwhile, when another context keeps the owner lock', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    expect(core.request('tab-a', init(1))).toEqual([]);
    expect(core.request('tab-b', clear(2))).toEqual([]);
    expect(core.request('tab-b', rollback(3))).toEqual([]);
    core.beginOwnerLockWait('tab-a', 1);

    const actions = core.ownerLockUnavailable('tab-a', 1, 'owner-lock-timeout');

    const unavailable = {
      kind: 'reject-request',
      error: expect.stringContaining('owner lock is held'),
      errorCode: 'owner-lock-unavailable',
    };
    expect(actions).toEqual([
      { kind: 'close-engine-route', tabId: 'tab-a', ownerEpoch: 1 },
      {
        kind: 'broadcast-cache-unavailable',
        reason: expect.stringContaining('another app version'),
        unavailableReason: 'owner-lock-timeout',
      },
      { ...unavailable, tabId: 'tab-b', requestId: 2 },
      { kind: 'schedule-reset-activation' },
    ]);
    // A handshake and a decided mutation wait for an engine; the rest does not.
    expect(core.request('tab-b', init(4))).toEqual([]);
    expect(core.request('tab-b', clear(5))).toEqual([
      { ...unavailable, tabId: 'tab-b', requestId: 5 },
    ]);
    expect(core.ownerLockUnavailable('tab-a', 1, 'owner-lock-timeout')).toEqual(
      []
    );
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
    const owner = core.state.kind === 'activating' ? core.state.tabId : '';
    // Another failed attempt tells nobody again.
    core.beginOwnerLockWait(owner, 2);
    expect(core.ownerLockUnavailable(owner, 2, 'owner-lock-timeout')).toEqual([
      { kind: 'close-engine-route', tabId: owner, ownerEpoch: 2 },
      { kind: 'schedule-reset-activation' },
    ]);
    // A page that comes meanwhile is told, and starts an attempt at once.
    const joined = core.registerTab('tab-c');
    expect(joined[0]).toEqual({
      kind: 'notify-cache-unavailable',
      tabId: 'tab-c',
      reason: expect.stringContaining('another app version'),
      unavailableReason: 'owner-lock-timeout',
    });
    const elected = action(joined, 'elect-owner');
    expect(elected).toMatchObject({ ownerEpoch: 3 });
    const routed = ready(core, elected.tabId, 3, 'opened-existing');
    expect(
      routed.flatMap((item) =>
        item.kind === 'route-request' ? [item.request.kind] : []
      )
    ).toEqual(['init', 'rollback-optimistic-write', 'init']);
    expect(
      action(core.request('tab-b', clear(6)), 'route-request')
    ).toBeTruthy();
  });

  it('never fails closed once storage may have been touched', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    grantStorage(core, 'tab-a', 1);

    expect(core.ownerLockUnavailable('tab-a', 1, 'owner-lock-timeout')).toEqual(
      []
    );
    expect(core.state).toMatchObject({
      kind: 'activating',
      phase: 'opening-database',
    });
  });

  it('keeps a pending recovery wipe for the attempt after an unavailable lock', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.ownerLost('tab-a', 1, 'engine failed');
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      databaseAction: 'wipe-before-open',
    });
    core.beginOwnerLockWait('tab-b', 2);

    core.ownerLockUnavailable('tab-b', 2, 'owner-lock-timeout');

    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      ownerEpoch: 3,
      databaseAction: 'wipe-before-open',
    });
  });

  it('goes on trying without a wipe when the database files stay busy', () => {
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
      { kind: 'close-engine-route', tabId: 'tab-a', ownerEpoch: 1 },
      {
        kind: 'broadcast-cache-unavailable',
        reason: expect.stringContaining('files are still open'),
        unavailableReason: 'files-busy',
      },
      { kind: 'schedule-reset-activation' },
    ]);
    expect(core.request('tab-a', clear(2))).toEqual([
      { ...unavailable, tabId: 'tab-a', requestId: 2 },
    ]);
    expect(core.storageBusy('tab-a', 1)).toEqual([]);
    // The open changed nothing, so the next one repairs nothing.
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
  });

  it('hands the database to a newer build and never elects again', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    expect(core.request('tab-b', init(1))).toMatchObject([
      { kind: 'route-request', ownerEpoch: 1 },
    ]);

    // The engine first settles what it was given.
    expect(core.supersede()).toEqual([
      { kind: 'drain-owner', tabId: 'tab-a', ownerEpoch: 1, handoff: true },
    ]);
    expect(core.handingOver).toBe(true);
    expect(core.superseded).toBe(false);
    expect(core.supersede()).toEqual([]);
    expect(core.engineDrained('tab-a', 1)).toContainEqual({
      kind: 'broadcast-cache-superseded',
      reason: expect.stringContaining('newer version of the app'),
    });
    expect(core.superseded).toBe(true);
    expect(core.supersede()).toEqual([]);
    expect(core.request('tab-b', clear(2))).toEqual([
      expect.objectContaining({
        kind: 'reject-request',
        requestId: 2,
        errorCode: 'cache-superseded',
      }),
    ]);

    expect(core.state.kind).toBe('waiting-for-tab');
    // A page of this build that loads afterwards is sent there too; it reloads
    // by itself once per build.
    expect(core.registerTab('tab-c')).toEqual([
      {
        kind: 'notify-cache-superseded',
        tabId: 'tab-c',
        reason: expect.stringContaining('newer version of the app'),
      },
    ]);
  });

  it('completes the handover once no engine is changing the files', () => {
    const activating = new CoordinatorCore('scope');
    activating.registerTab('tab-a');
    grantStorage(activating, 'tab-a', 1);
    expect(activating.supersede()).toEqual([]);
    expect(activating.handingOver).toBe(true);
    // The handover completes once the opening engine is ready, and drained.
    expect(
      activating.engineReady({
        tabId: 'tab-a',
        ownerEpoch: 1,
        ownerLockName: OWNER_LOCK,
        expectedOwnerLockName: OWNER_LOCK,
        ownerLockHeld: true,
        databaseActionProof: 'opened-existing',
        openOutcome: 'opened-existing',
      })
    ).toContainEqual({
      kind: 'drain-owner',
      tabId: 'tab-a',
      ownerEpoch: 1,
      handoff: true,
    });
    expect(activating.engineDrained('tab-a', 1)).toContainEqual({
      kind: 'broadcast-cache-superseded',
      reason: expect.stringContaining('newer version of the app'),
    });
    expect(activating.superseded).toBe(true);

    // A draining engine closes its files first, and nothing is elected after
    // it even though a visible tab remains.
    const draining = new CoordinatorCore('scope');
    draining.registerTab('tab-a');
    draining.registerTab('tab-b');
    ready(draining, 'tab-a', 1, 'opened-existing');
    draining.setTabVisibility('tab-a', false);
    expect(action(draining.drainHiddenOwner(1), 'drain-owner')).toMatchObject({
      tabId: 'tab-a',
      handoff: true,
    });
    expect(draining.supersede()).toEqual([]);
    expect(draining.handingOver).toBe(true);
    const drained = draining.engineDrained('tab-a', 1);
    expect(drained).toContainEqual({
      kind: 'broadcast-cache-superseded',
      reason: expect.stringContaining('newer version of the app'),
    });
    expect(drained.some((item) => item.kind === 'elect-owner')).toBe(false);
    expect(draining.state.kind).toBe('waiting-for-tab');

    // An idle coordinator's tabs, already uncached, move on too.
    const idle = new CoordinatorCore('scope');
    idle.registerTab('tab-a');
    idle.beginOwnerLockWait('tab-a', 1);
    idle.ownerLockUnavailable('tab-a', 1, 'owner-lock-timeout');
    expect(idle.supersede()).toEqual([
      {
        kind: 'broadcast-cache-superseded',
        reason: expect.stringContaining('newer version of the app'),
      },
    ]);
  });

  it('hands over instead of wiping after losing an engine promised to a newer build', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    grantStorage(core, 'tab-a', 1);
    expect(core.supersede()).toEqual([]);

    core.ownerLost('tab-a', 1, 'engine failed');
    expect(core.state.kind).toBe('resetting-after-loss');

    expect(core.resumeAfterLoss()).toEqual([
      {
        kind: 'broadcast-cache-superseded',
        reason: expect.stringContaining('newer version of the app'),
      },
    ]);
    expect(core.superseded).toBe(true);
    expect(core.state.kind).toBe('waiting-for-tab');
    expect(core.registerTab('tab-c')).toEqual([
      {
        kind: 'notify-cache-superseded',
        tabId: 'tab-c',
        reason: expect.stringContaining('newer version of the app'),
      },
    ]);
  });

  it('moves every tab on when a newer build has the database at startup', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    core.request('tab-a', init(1));
    core.beginOwnerLockWait('tab-a', 1);

    const actions = core.heldByNewerBuild('tab-a', 1);

    expect(actions).toContainEqual({
      kind: 'close-engine-route',
      tabId: 'tab-a',
      ownerEpoch: 1,
    });
    expect(actions).toContainEqual({
      kind: 'broadcast-cache-superseded',
      reason: expect.stringContaining('newer version of the app'),
    });
    expect(actions).toContainEqual(
      expect.objectContaining({
        kind: 'reject-request',
        requestId: 1,
        errorCode: 'cache-superseded',
      })
    );
    expect(actions.some(({ kind }) => kind === 'elect-owner')).toBe(false);
    expect(core.superseded).toBe(true);
    // An engine that was let at the database opens it: no older one does then.
    const opening = new CoordinatorCore('scope');
    opening.registerTab('tab-a');
    grantStorage(opening, 'tab-a', 1);
    expect(opening.heldByNewerBuild('tab-a', 1)).toEqual([]);
  });

  it('keeps a pending recovery wipe when its files stay busy', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.ownerLost('tab-a', 1, 'engine failed');
    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      databaseAction: 'wipe-before-open',
    });
    grantStorage(core, 'tab-b', 2);

    core.storageBusy('tab-b', 2);

    expect(action(core.resumeAfterLoss(), 'elect-owner')).toMatchObject({
      ownerEpoch: 3,
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

  it('leaves alone a departure from an epoch that is over', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.setTabVisibility('tab-a', false);
    core.drainHiddenOwner(1);
    core.engineDrained('tab-a', 1);
    core.setTabVisibility('tab-a', true);
    const { state } = core;
    expect(state).toMatchObject({ kind: 'activating', ownerEpoch: 2 });

    expect(core.beginGracefulDeparture('tab-a', 1)).toEqual([]);

    expect(core.state).toEqual(state);
    expect(core.snapshot().protocolViolations).toBe(0);
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

  it('tells a request its drained engine never answered that the owner was lost', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.request('tab-b', clear(9));
    core.beginGracefulDeparture('tab-a', 1);

    expect(core.engineDrained('tab-a', 1)).toContainEqual({
      kind: 'reject-request',
      tabId: 'tab-b',
      requestId: 9,
      error: 'engine drained before delivering its response',
      errorCode: 'owner-epoch-lost',
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

  it.each(['navigation', 'graceful', 'abrupt'] as const)(
    'keeps routed enqueues uncertain and unrouted enqueues queued after %s departure',
    (departureKind) => {
      const core = new CoordinatorCore('scope');
      core.registerTab('tab-a');
      core.registerTab('tab-b');
      ready(core, 'tab-a', 1, 'opened-existing');
      const enqueue = {
        id: 9,
        kind: 'enqueue-optimistic-mutation',
        uuid: '00000000-0000-4000-8000-000000000001',
        query: 'mutation Enqueue { enqueue }',
        data: { enqueue: true },
        createdAtMs: 1,
        owner: 'tab-b',
        nowMs: 1,
        leaseExpiresAtMs: 300_001,
      } satisfies CacheRequest;
      const routed = action(core.request('tab-b', enqueue), 'route-request');
      core.beginGracefulDeparture('tab-a', 1);
      const queued = {
        ...enqueue,
        id: 10,
        uuid: '00000000-0000-4000-8000-000000000002',
      };
      expect(core.request('tab-b', queued)).toEqual([]);

      const departure = match(departureKind)
        .with('navigation', () =>
          core.departForNavigation('tab-a', 1, 'pagehide')
        )
        .with('graceful', () => core.engineDrained('tab-a', 1))
        .with('abrupt', () => [
          ...core.ownerLost('tab-a', 1, 'worker stopped'),
          ...core.resumeAfterLoss(),
        ])
        .exhaustive();
      expect(departure.filter(({ kind }) => kind === 'reject-request')).toEqual(
        [
          {
            kind: 'reject-request',
            tabId: 'tab-b',
            requestId: 9,
            error: expect.any(String),
            errorCode: 'admitted-enqueue-uncertain',
          },
        ]
      );
      expect(action(departure, 'elect-owner')).toMatchObject({
        tabId: 'tab-b',
        ownerEpoch: 2,
        databaseAction:
          departureKind === 'abrupt' ? 'wipe-before-open' : 'open-existing',
      });
      const replacement = ready(
        core,
        'tab-b',
        2,
        departureKind === 'abrupt' ? 'wiped-before-open' : 'opened-existing'
      );
      expect(
        replacement.filter(({ kind }) => kind === 'route-request')
      ).toEqual([
        expect.objectContaining({
          ownerEpoch: 2,
          request: { ...queued, id: expect.any(Number) },
        }),
      ]);
      expect(
        core.engineResponse(1, routed.routeId, {
          id: routed.routeId,
          ok: true,
          result: null,
        })
      ).toEqual([
        expect.objectContaining({ kind: 'drop-stale-engine-message' }),
      ]);
    }
  );

  it('refuses only the writes queued long enough, and never one an engine was given', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    const enqueue = (id: number) =>
      ({
        id,
        kind: 'enqueue-optimistic-mutation',
        uuid: `00000000-0000-4000-8000-00000000000${id}`,
        query: 'mutation Enqueue { enqueue }',
        data: { enqueue: true },
        createdAtMs: 1,
        owner: 'tab-b',
        nowMs: 1,
        leaseExpiresAtMs: 300_001,
      }) satisfies CacheRequest;
    ready(core, 'tab-a', 1, 'opened-existing');
    action(core.request('tab-b', enqueue(1), 0), 'route-request');
    core.beginGracefulDeparture('tab-a', 1);
    expect(core.oldestQueuedWriteAt).toBeUndefined();

    core.request('tab-b', { id: 2, kind: 'current-revision' }, 5);
    core.request('tab-b', { id: 3, kind: 'delete-records', keys: ['A:1'] }, 5);
    core.request('tab-b', { id: 4, kind: 'clear' }, 5);
    core.request(
      'tab-b',
      {
        id: 5,
        kind: 'rollback-optimistic-write',
        transactionId: '1',
        leaseOwner: 'tab-b',
        leaseGeneration: '1',
        error: 'refused by the server',
      },
      5
    );
    core.request('tab-b', enqueue(6), 10);
    core.request('tab-b', enqueue(7), 11);
    expect(core.oldestQueuedWriteAt).toBe(10);
    expect(core.refuseQueuedWrites(9)).toEqual([]);
    expect(core.refuseQueuedWrites(10)).toEqual([
      {
        kind: 'reject-request',
        tabId: 'tab-b',
        requestId: 6,
        error: 'cache write timeout: no owner took it',
        errorCode: 'write-not-admitted',
      },
    ]);
    expect(core.oldestQueuedWriteAt).toBe(11);

    // What is left reaches the next owner in order; what was refused does not.
    core.engineDrained('tab-a', 1);
    const replacement = ready(core, 'tab-b', 2, 'opened-existing');
    expect(
      replacement
        .filter((next) => next.kind === 'route-request')
        .map(({ request }) => request.kind)
    ).toEqual([
      'current-revision',
      'delete-records',
      'clear',
      'rollback-optimistic-write',
      'enqueue-optimistic-mutation',
    ]);
  });

  it.each([false, true])(
    'announces a reset before draining a hidden recovery owner (visible survivor: %s)',
    (visibleSurvivor) => {
      const core = new CoordinatorCore('scope');
      core.registerTab('tab-a');
      core.registerTab('tab-b');
      ready(core, 'tab-a', 1, 'opened-existing');
      core.ownerLost('tab-a', 1, 'engine failed');
      core.resumeAfterLoss();
      core.setTabVisibility('tab-a', visibleSurvivor);
      core.setTabVisibility('tab-b', false);
      expect(
        core.request('tab-a', { id: 9, kind: 'current-revision' })
      ).toEqual([]);

      expect(ready(core, 'tab-b', 2, 'wiped-before-open')).toEqual([
        {
          kind: 'broadcast-engine-replaced',
          ownerEpoch: 2,
          openOutcome: 'reset-storage-uncertain',
        },
        { kind: 'drain-owner', tabId: 'tab-b', ownerEpoch: 2, handoff: true },
      ]);
      expect(core.state.kind).toBe('draining');
      expect(core.snapshot().inFlightRequestCount).toBe(0);
      expect(core.snapshot().queuedRequestCount).toBe(1);
      core.engineDrained('tab-b', 2);
      if (!visibleSurvivor) {
        expect(core.state.kind).toBe('parked');
        core.setTabVisibility('tab-a', true);
      }
      const reopened = ready(core, 'tab-a', 3, 'opened-existing');
      expect(action(reopened, 'broadcast-engine-replaced')).toMatchObject({
        ownerEpoch: 3,
        openOutcome: 'opened-existing',
      });
      expect(action(reopened, 'route-request')).toMatchObject({
        ownerEpoch: 3,
        requesterTabId: 'tab-a',
        request: { kind: 'current-revision' },
      });
    }
  );

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

  it('keeps the database when the owner page is lost, and the owner when a standby is', () => {
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
    const actions = core.tabLost('tab-a');
    expect(actions).toContainEqual({ kind: 'drop-tab', tabId: 'tab-a' });
    expect(action(actions, 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
  });

  it('keeps a pending recovery wipe when the page running it is lost', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.ownerLost('tab-a', 1, 'engine failed');
    core.resumeAfterLoss();
    grantStorage(core, 'tab-b', 2);

    expect(action(core.tabLost('tab-b'), 'elect-owner')).toMatchObject({
      tabId: 'tab-a',
      ownerEpoch: 3,
      databaseAction: 'wipe-before-open',
    });
  });

  it('opens an interrupted open again when its page is lost', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    grantStorage(core, 'tab-a', 1);

    expect(action(core.tabLost('tab-a'), 'elect-owner')).toMatchObject({
      tabId: 'tab-b',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
  });

  it('hands over at once when the page running a promised engine is lost', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    grantStorage(core, 'tab-a', 1);
    expect(core.supersede()).toEqual([]);

    const actions = core.tabLost('tab-a');

    expect(actions).toContainEqual({
      kind: 'broadcast-cache-superseded',
      reason: expect.stringContaining('newer version of the app'),
    });
    expect(core.superseded).toBe(true);
    expect(core.state).toEqual({
      kind: 'waiting-for-tab',
      nextDatabaseAction: 'open-existing',
    });
  });

  it.each(['active', 'draining'] as const)(
    'refuses what a lost page left with its %s engine',
    (phase) => {
      const core = new CoordinatorCore('scope');
      core.registerTab('tab-a');
      core.registerTab('tab-b');
      ready(core, 'tab-a', 1, 'opened-existing');
      core.request('tab-b', init(7));
      if (phase === 'draining') core.beginGracefulDeparture('tab-a', 1);

      expect(core.tabLost('tab-a')).toContainEqual({
        kind: 'reject-request',
        tabId: 'tab-b',
        requestId: 7,
        error: 'owner epoch 1 was lost: tab liveness lock was released',
        errorCode: 'owner-epoch-lost',
      });
    }
  );

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
    core.ownerLost('tab-a', 1, 'engine failed');
    core.setTabVisibility('tab-a', false);
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

  it('refuses work while recovery keeps failing, and serves every tab once it succeeds', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('tab-a');
    core.registerTab('tab-b');
    ready(core, 'tab-a', 1, 'opened-existing');
    core.ownerLost('tab-a', 1, 'OPFS recovery failed');
    core.request('tab-b', { id: 7, kind: 'clear' });

    expect(core.beginOutage('recovery fails', 'recovery-failed')).toEqual([
      {
        kind: 'broadcast-cache-unavailable',
        reason: 'recovery fails',
        unavailableReason: 'recovery-failed',
      },
      {
        kind: 'reject-request',
        tabId: 'tab-b',
        requestId: 7,
        error: 'recovery fails',
        errorCode: 'owner-lock-unavailable',
      },
    ]);
    expect(core.beginOutage('recovery fails', 'recovery-failed')).toEqual([]);
    expect(core.state.kind).toBe('resetting-after-loss');
    // Showing a page tries again without waiting for the backoff.
    expect(core.setTabVisibility('tab-b', false)).toEqual([]);
    const elected = action(core.setTabVisibility('tab-b', true), 'elect-owner');
    expect(elected).toMatchObject({
      ownerEpoch: 2,
      databaseAction: 'wipe-before-open',
    });
    ready(core, elected.tabId, 2, 'wiped-before-open');
    expect(
      action(core.request('tab-a', { id: 8, kind: 'clear' }), 'route-request')
    ).toBeTruthy();
    expect(core.registerTab('tab-c')).toEqual([]);
  });
});
