import { setImmediate } from 'node:timers/promises';
import {
  CompatInstanceBind,
  ForeignRenderRecord,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { expect, test } from 'vitest';
import { RawCaptureFixture } from './capture-fixture';

test('production raw capture owner finalizer releases the exact native lease after real GC', async () => {
  const collect = global.gc;
  if (!collect) throw new Error('Raw capture smoke requires --expose-gc');
  const fixture = new RawCaptureFixture();
  try {
    fixture.startAndSeed();
    const handle = (() => {
      const node = fixture.wrapper(fixture.initialRecord);
      return new WeakRef(node);
    })();
    const rawHandle = fixture.records.handle(fixture.initialRecord);
    fixture.flushLeases();
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => {}
    );
    expect(fixture.collector.drain()).toBe(true);
    fixture.releaseInitialOwner();
    fixture.flushLeases();
    expect(fixture.readInitialType()).toBe('root');
    fixture.recorder.setPhase('gc');
    const finalized = new Promise<void>((resolve) => {
      fixture.onCaptureFinalized = (record) => {
        expect(record).toBe(fixture.initialRecord);
        resolve();
      };
    });
    const acknowledged = new Promise<void>((resolve) => {
      fixture.onCaptureAcknowledged = resolve;
    });
    await setImmediate();
    const before = fixture.audit();
    const beforeCall = fixture
      .apiCalls('EditorSession.compatAuditSnapshot')
      .at(-1);
    if (!beforeCall?.completed)
      throw new Error('Missing native before receipt');
    fixture.event('actual-engine-gc-request');
    const completion = collect({ execution: 'async', type: 'major' });
    if (!(completion instanceof Promise))
      throw new Error('Missing actual GC completion promise');
    await completion;
    fixture.event('actual-engine-gc-complete');
    await finalized;
    await acknowledged;
    expect(handle.deref()).toBeUndefined();
    expect(fixture.finalized).toEqual([fixture.initialRecord.captureId]);
    expect(() => fixture.records.reference(rawHandle)).toThrow('released');
    expect(fixture.drainCaptures()).toBe(true);
    fixture.event('observed-js-capture-release-fence');
    fixture.flushLeases();
    const fence = fixture.apiCalls('EditorSession.compatCaptureLeases').at(-1);
    if (!fence?.completed)
      throw new Error('Missing actual native capture prune fence');
    const after = fixture.audit();
    const afterCall = fixture
      .apiCalls('EditorSession.compatAuditSnapshot')
      .at(-1);
    if (!afterCall?.completed) throw new Error('Missing native after receipt');
    expect(after.version).toBe(before.version);
    expect(after.retirementEpoch).toBeGreaterThan(before.retirementEpoch);
    expect(after.retainedCaptures).toBeLessThan(before.retainedCaptures);
    expect(after.retainedCaptures).toBeLessThanOrEqual(2n * after.liveNodes);
    expect(beforeCall.leaveSequence).toBeLessThan(fence.enterSequence);
    expect(fence.leaveSequence).toBeLessThan(afterCall.enterSequence);
    expect(() => fixture.readInitialType()).toThrow();
    fixture.close();
    fixture.proof('raw-capture-gc', {
      before,
      after,
      beforeSnapshotCallId: beforeCall.id,
      nativePruneCallIds: [fence.id],
      afterSnapshotCallId: afterCall.id,
      finalizedCaptureIds: fixture.finalized,
      ownerCapture: fixture.initialRecord,
      rawHandle,
      releaseDeliveryCallIds: fixture
        .apiCalls('EditorSession.compatCaptureLeases')
        .filter(
          (call) =>
            call.enterSequence > beforeCall.leaveSequence &&
            call.leaveSequence < afterCall.enterSequence
        )
        .map((call) => call.id),
      captureFinalizerProven: true,
      producer: 'production CaptureOwners registry through actual NodeHandles',
    });
  } finally {
    fixture.close();
  }
}, 30000);

test('actual mirror counts keep a raw wrapper alive until the last graph owner leaves', async () => {
  const collect = global.gc;
  if (!collect) throw new Error('Graph ownership smoke requires --expose-gc');
  const fixture = new RawCaptureFixture();
  try {
    fixture.startAndSeed();
    const target = (() =>
      new WeakRef(fixture.wrapper(fixture.initialRecord)))();
    const handle = fixture.records.handle(fixture.initialRecord);
    fixture.captures.retainHandle(handle);
    fixture.captures.retainHandle(handle);
    fixture.flushLeases();
    await setImmediate();
    await collect({ execution: 'async', type: 'major' });
    expect(target.deref()).toBeDefined();
    expect(fixture.finalized).toEqual([]);
    fixture.captures.releaseHandle(handle);
    await setImmediate();
    await collect({ execution: 'async', type: 'major' });
    expect(target.deref()).toBeDefined();
    expect(fixture.finalized).toEqual([]);
    const acknowledged = new Promise<void>((resolve) => {
      fixture.onCaptureAcknowledged = resolve;
    });
    fixture.captures.releaseHandle(handle);
    await setImmediate();
    await collect({ execution: 'async', type: 'major' });
    await acknowledged;
    expect(target.deref()).toBeUndefined();
    expect(fixture.finalized).toEqual([fixture.initialRecord.captureId]);
    expect(() => fixture.captures.releaseHandle(handle)).toThrow('no owner');
  } finally {
    fixture.close();
  }
}, 30000);

test('production owner identity and authority reject invalid refresh without losing the live lease', () => {
  const fixture = new RawCaptureFixture();
  try {
    fixture.startAndSeed();
    const node = fixture.wrapper(fixture.initialRecord);
    const handle = fixture.records.handle(fixture.initialRecord);
    const owner = fixture.captures.own(handle, node, fixture.initialRecord);
    expect(fixture.captures.own(handle, node, fixture.initialRecord)).toBe(
      owner
    );
    expect(() =>
      fixture.captures.own(handle, {}, fixture.initialRecord)
    ).toThrow('live native instance');
    const changed = {
      ...fixture.initialRecord,
      updateId: fixture.initialRecord.updateId + 1,
    };
    expect(() => fixture.captures.refresh(handle, changed)).toThrow(
      'authority changed'
    );
    expect(() =>
      fixture.captures.refresh(handle, {
        ...fixture.initialRecord,
        captureId: 0n,
      })
    ).toThrow('issued nonzero');
    fixture.captures.refresh(handle, fixture.initialRecord);
    fixture.flushLeases();
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => {}
    );
    expect(fixture.collector.drain()).toBe(true);
    fixture.releaseInitialOwner();
    fixture.flushLeases();
    expect(fixture.readInitialType()).toBe('root');
    expect(fixture.handles.hasIdentity(handle, node)).toBe(true);
  } finally {
    fixture.close();
  }
});

test('real native hydration refresh retains the new capture and finalizes only its latest lease', async () => {
  const collect = global.gc;
  if (!collect) throw new Error('Refresh finalizer smoke requires --expose-gc');
  const fixture = new RawCaptureFixture(true);
  try {
    const handle = (() => {
      const node = fixture.wrapper(fixture.initialRecord);
      const value = fixture.records.handle(fixture.initialRecord);
      expect(fixture.handles.hasIdentity(value, node)).toBe(true);
      return value;
    })();
    fixture.flushLeases();
    const next = ForeignRenderRecord.decode(
      fixture.call('EditorSession.compatBindInstance', () =>
        fixture.session.compatBindInstance(
          CompatInstanceBind.encode({
            record: fixture.initialRecord,
            instanceOwnerId: fixture.editorId,
            classId: 1,
            instanceId: 1,
          }).slice()
        )
      )
    );
    expect(next.record.captureId).not.toBe(fixture.initialRecord.captureId);
    fixture.records.bind(handle, next);
    fixture.records.accept([next]);
    expect(fixture.leases.hasOwners(next.record.captureId)).toBe(true);
    fixture.releaseInitialOwner();
    expect(fixture.leases.hasOwners(fixture.initialRecord.captureId)).toBe(
      false
    );
    fixture.flushLeases();
    expect(fixture.records.reference(handle)).toBe(next.record);
    const acknowledged = new Promise<void>((resolve) => {
      fixture.onCaptureAcknowledged = resolve;
    });
    await setImmediate();
    const completion = collect({ execution: 'async', type: 'major' });
    if (!(completion instanceof Promise))
      throw new Error('Missing actual refresh GC completion');
    await completion;
    await acknowledged;
    expect(fixture.finalized).toEqual([next.record.captureId]);
    expect(fixture.leases.hasOwners(next.record.captureId)).toBe(false);
  } finally {
    fixture.close();
  }
});

test('an actual late finalizer cannot remove a replacement token or graph owner', async () => {
  const collect = global.gc;
  if (!collect)
    throw new Error('Replacement finalizer smoke requires --expose-gc');
  const fixture = new RawCaptureFixture();
  try {
    const old = (() => new WeakRef(fixture.wrapper(fixture.initialRecord)))();
    const handle = fixture.records.handle(fixture.initialRecord);
    fixture.flushLeases();
    await setImmediate();
    // Synchronous engine completion leaves finalizer jobs queued until this stack exits.
    collect({ execution: 'sync', type: 'major' });
    expect(old.deref()).toBeUndefined();
    expect(fixture.finalized).toEqual([]);
    const replacement = fixture.wrapper(fixture.initialRecord);
    fixture.captures.retainHandle(handle);
    const acknowledged = new Promise<void>((resolve) => {
      fixture.onCaptureAcknowledged = resolve;
    });
    await acknowledged;
    expect(fixture.finalized).toEqual([fixture.initialRecord.captureId]);
    expect(fixture.handles.hasIdentity(handle, replacement)).toBe(true);
    expect(fixture.records.reference(handle)).toBe(fixture.initialRecord);
    expect(fixture.leases.hasOwners(fixture.initialRecord.captureId)).toBe(
      true
    );
    fixture.captures.releaseHandle(handle);
  } finally {
    fixture.close();
  }
}, 30000);
