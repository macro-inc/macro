import { describe, expect, it } from 'vitest';
import { CoordinatorCore } from './coordinator-core';
import {
  CACHE_COORDINATOR_PROTOCOL_VERSION,
  validateCoordinatorToTabEnvelope,
  validateTabToCoordinatorEnvelope,
} from './coordinator-protocol';

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

describe('visibility ownership', () => {
  it('validates visibility and handoff epoch messages without accepting extra fields', () => {
    const visibility = {
      coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
      kind: 'tab-visibility',
      tabId: 'a',
      visible: false,
    };
    expect(validateTabToCoordinatorEnvelope(visibility).ok).toBe(true);
    expect(
      validateTabToCoordinatorEnvelope({ ...visibility, visible: 'hidden' }).ok
    ).toBe(false);
    expect(
      validateTabToCoordinatorEnvelope({ ...visibility, ownerEpoch: 1 }).ok
    ).toBe(false);
    const blocked = {
      coordinatorVersion: CACHE_COORDINATOR_PROTOCOL_VERSION,
      kind: 'cache-read-availability',
      ownerEpoch: 1,
      state: 'blocked',
    };
    expect(validateCoordinatorToTabEnvelope(blocked).ok).toBe(true);
    expect(
      validateCoordinatorToTabEnvelope({ ...blocked, ownerEpoch: 0 }).ok
    ).toBe(false);
    expect(
      validateCoordinatorToTabEnvelope({
        ...blocked,
        ownerEpoch: 0,
        state: 'waiting',
      }).ok
    ).toBe(true);
    expect(
      validateCoordinatorToTabEnvelope({ ...blocked, state: 'invalid' }).ok
    ).toBe(false);
    expect(
      validateCoordinatorToTabEnvelope({ ...blocked, visible: false }).ok
    ).toBe(false);
  });
  it('keeps a visible owner but starts parking on the last visible tab exit', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('a', true);
    ready(core, 'a', 1);
    expect(core.registerTab('b', true)).toEqual([]);
    expect(core.setTabVisibility('b', false)).toEqual([]);
    expect(core.setTabVisibility('a', false)).toEqual([
      { kind: 'drain-owner', tabId: 'a', ownerEpoch: 1, handoff: true },
    ]);
    expect(core.state).toEqual({ kind: 'draining', tabId: 'a', ownerEpoch: 1 });
    expect(core.setTabVisibility('a', true)).toEqual([]);
  });

  it('drains a hidden owner, keeps its client, and routes waiting work once to a visible survivor', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('a', true);
    ready(core, 'a', 1);
    core.registerTab('b', true);
    expect(core.setTabVisibility('a', false)).toEqual([
      { kind: 'drain-owner', tabId: 'a', ownerEpoch: 1, handoff: true },
    ]);
    expect(core.registerTab('c', true)).toEqual([]);
    expect(core.setTabVisibility('a', false)).toEqual([]);
    expect(core.request('a', { id: 8, kind: 'current-revision' })).toEqual([]);
    expect(core.request('b', { id: 9, kind: 'clear' })).toEqual([]);
    expect(core.snapshot().ownerEpoch).toBe(1);
    expect(core.snapshot().queuedRequestCount).toBe(2);

    const drained = core.engineDrained('a', 1);
    expect(drained).toEqual([
      { kind: 'close-engine-route', tabId: 'a', ownerEpoch: 1 },
      { kind: 'release-owner', tabId: 'a', ownerEpoch: 1 },
      {
        kind: 'elect-owner',
        tabId: 'b',
        ownerEpoch: 2,
        databaseAction: 'open-existing',
      },
    ]);
    expect(core.snapshot().tabIds).toEqual(['a', 'b', 'c']);
    const replacement = ready(core, 'b', 2);
    expect(
      replacement.filter((action) => action.kind === 'route-request')
    ).toMatchObject([
      {
        requesterTabId: 'a',
        ownerEpoch: 2,
        request: { kind: 'current-revision' },
      },
      { requesterTabId: 'b', ownerEpoch: 2, request: { kind: 'clear' } },
    ]);
    expect(core.snapshot().queuedRequestCount).toBe(0);
    expect(core.engineDrained('a', 1)).toMatchObject([
      { kind: 'protocol-violation' },
    ]);
    expect(core.setTabVisibility('a', true)).toEqual([]);
    expect(core.state).toEqual({ kind: 'active', tabId: 'b', ownerEpoch: 2 });
  });

  it('chooses from the latest surviving visibility instead of pinning a departed candidate', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('a', true);
    ready(core, 'a', 1);
    core.registerTab('b', true);
    core.setTabVisibility('a', false);
    core.registerTab('c', true);
    core.tabLost('b');
    core.setTabVisibility('b', true);
    expect(core.engineDrained('a', 1)).toContainEqual({
      kind: 'elect-owner',
      tabId: 'c',
      ownerEpoch: 2,
      databaseAction: 'open-existing',
    });
  });

  it('defers a startup visibility change until storage is ready to drain', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('a', true);
    core.registerTab('b', true);
    expect(core.setTabVisibility('a', false)).toEqual([
      { kind: 'handoff-pending', ownerEpoch: 1 },
    ]);
    expect(core.state.kind).toBe('activating');
    core.request('b', { id: 1, kind: 'clear' });
    expect(ready(core, 'a', 1)).toEqual([
      { kind: 'drain-owner', tabId: 'a', ownerEpoch: 1, handoff: true },
    ]);
    expect(core.snapshot().inFlightRequestCount).toBe(0);
    core.engineDrained('a', 1);
    expect(
      ready(core, 'b', 2).filter((action) => action.kind === 'route-request')
    ).toHaveLength(1);
  });

  it('lets explicit disposal join a handoff without draining twice', () => {
    const core = new CoordinatorCore('scope');
    core.registerTab('a', true);
    ready(core, 'a', 1);
    core.registerTab('b', true);
    core.setTabVisibility('a', false);
    expect(core.beginGracefulDeparture('a', 1)).toEqual([]);
    expect(core.engineDrained('a', 1)).toContainEqual({
      kind: 'retire-tab',
      tabId: 'a',
      ownerEpoch: 1,
    });
    expect(core.snapshot().tabIds).toEqual(['b']);
  });
});
