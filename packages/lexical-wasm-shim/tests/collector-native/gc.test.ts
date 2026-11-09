import { setImmediate } from 'node:timers';
import { expect, test } from 'vitest';
import { NativeFixture } from './fixture';

test('sole NodeHandles finalizer retires a real native historical graph after observed V8 GC', async () => {
  const collect = global.gc;
  if (!collect)
    throw new Error(
      'Real collector smoke requires --expose-gc; no manual finalizer substitute'
    );
  const fixture = new NativeFixture('microtask');
  try {
    fixture.startAndSeed();
    if (fixture.current > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('Fixture version exceeds JS token range');
    const currentPin = fixture.handles.pinVersion(Number(fixture.current));
    const historical = (() => {
      const pin = fixture.handles.pinVersion(Number(fixture.initial.version));
      return new WeakRef(pin);
    })();
    let finalizerCallbacks = 0;
    const released = new Promise<void>((resolve) => {
      fixture.onCollected = (version) => {
        expect(version).toBe(fixture.initial.version);
        finalizerCallbacks++;
        resolve();
      };
    });
    // Cross WeakRef's current-job keep-alive boundary, not a sleep or a poll.
    await new Promise<void>((resolve) => setImmediate(resolve));
    fixture.recorder.setPhase('gc');
    const before = fixture.audit();
    const beforeCall = fixture
      .apiCalls('EditorSession.compatAuditSnapshot')
      .at(-1);
    if (!beforeCall) throw new Error('Missing actual before-snapshot call');
    fixture.event('actual-engine-gc-request');
    const completion = collect({ execution: 'async', type: 'major' });
    if (!(completion instanceof Promise))
      throw new Error('Native GC did not provide an actual completion promise');
    await completion;
    fixture.event('actual-engine-gc-complete');
    await released;
    expect(historical.deref()).toBeUndefined();
    expect(fixture.handles.pinVersion(Number(fixture.current))).toBe(
      currentPin
    );
    expect(finalizerCallbacks).toBe(1);
    expect(fixture.collector.drain()).toBe(true);
    fixture.event('observed-js-release-fence');
    // A real cold empty fence follows both GC completion and the observed JS queue.
    fixture.flushLeases();
    const fenceCall = fixture
      .apiCalls('EditorSession.compatCaptureLeases')
      .at(-1);
    if (!fenceCall?.completed)
      throw new Error('Missing actual completed native prune fence');
    const after = fixture.audit();
    const afterCall = fixture
      .apiCalls('EditorSession.compatAuditSnapshot')
      .at(-1);
    if (!afterCall) throw new Error('Missing actual after-snapshot call');
    expect(after.version).toBe(before.version);
    expect(after.retirementEpoch).toBeGreaterThan(before.retirementEpoch);
    expect(after.retainedCaptures).toBeLessThanOrEqual(after.liveNodes * 2n);
    expect(after.retainedCaptures).toBeLessThan(before.retainedCaptures);
    expect(beforeCall.leaveSequence).toBeLessThan(fenceCall.enterSequence);
    expect(fenceCall.leaveSequence).toBeLessThan(afterCall.enterSequence);
    expect(
      fixture.events.some(
        (event) => event.kind === 'actual-version-finalizer-enqueued'
      )
    ).toBe(true);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    fixture.close();
    fixture.proof('real-gc', {
      before,
      after,
      beforeSnapshotCallId: beforeCall.id,
      nativePruneCallIds: [fenceCall.id],
      afterSnapshotCallId: afterCall.id,
      finalizerCallbacks,
      eligibleVersion: fixture.initial.version,
      collectedTarget: historical.deref() === undefined,
      producer: 'sole existing NodeHandles FinalizationRegistry',
      captureFinalizerProven: false,
    });
  } finally {
    fixture.close();
  }
}, 30000);
