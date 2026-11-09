import { expect, test } from 'vitest';
import { NativeFixture } from './fixture';

test('real graph retirement preserves exact capture leases until their acknowledged release', () => {
  const fixture = new NativeFixture();
  try {
    fixture.startAndSeed();
    fixture.recorder.setPhase('gc');
    const before = fixture.audit();
    let callbacks = 0;
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => callbacks++
    );
    expect(fixture.collector.drain()).toBe(true);
    expect(callbacks).toBe(1);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    expect(() => fixture.snapshot(fixture.initial.version)).toThrow();
    expect(
      fixture.apiCalls('EditorSession.compatSnapshot').at(-1)?.completed
    ).toBe(false);
    expect(fixture.readInitialType()).toBe('root');
    const preserved = fixture.audit();
    expect(preserved.version).toBe(before.version);
    expect(preserved.retirementEpoch).toBeGreaterThan(before.retirementEpoch);
    fixture.releaseInitialOwner();
    fixture.flushLeases();
    const released = fixture.audit();
    expect(released.retainedCaptures).toBeLessThan(preserved.retainedCaptures);
    expect(released.retirementEpoch).toBeGreaterThan(preserved.retirementEpoch);
    expect(() => fixture.readInitialType()).toThrow();
    expect(fixture.apiCalls('EditorSession.compatCall').at(-1)?.completed).toBe(
      false
    );
    fixture.close();
    fixture.proof('capture-survives-graph', {
      before,
      preserved,
      released,
      callbacks,
    });
  } finally {
    fixture.close();
  }
});

test('actual active, pending and graph-leased guards prevent native retirement', () => {
  const fixture = new NativeFixture();
  try {
    fixture.startAndSeed();
    fixture.recorder.setPhase('gc');
    const before = fixture.audit();
    const drop = fixture.holdGraph(fixture.initial.version);
    let callbacks = 0;
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => callbacks++
    );
    fixture.collector.collect(
      fixture.current,
      () => true,
      () => callbacks++
    );
    expect(fixture.collector.drain()).toBe(false);
    expect(fixture.retired).toEqual([]);
    drop();
    fixture.beginPending();
    expect(fixture.collector.drain()).toBe(false);
    expect(fixture.retired).toEqual([]);
    fixture.discardPending();
    expect(fixture.collector.drain()).toBe(false); // current remains protected.
    expect(fixture.retired).toEqual([fixture.initial.version]);
    expect(callbacks).toBe(1);
    const after = fixture.audit();
    expect(after.version).toBe(before.version);
    expect(after.retirementEpoch).toBeGreaterThan(before.retirementEpoch);
    const beforeInvalid = fixture.audit();
    expect(() => fixture.releaseVersion(fixture.current)).toThrow();
    expect(() => fixture.releaseVersion(0xffffffffffffffffn)).toThrow();
    const afterInvalid = fixture.audit();
    expect(afterInvalid).toEqual(beforeInvalid);
    fixture.close();
    fixture.proof('actual-guards', {
      before,
      after,
      beforeInvalid,
      afterInvalid,
      callbacks,
    });
  } finally {
    fixture.close();
  }
});

test('post-ack native lease rejection retries cleanup without retiring or notifying twice', () => {
  const fixture = new NativeFixture();
  try {
    fixture.startAndSeed();
    fixture.recorder.setPhase('gc');
    const before = fixture.audit();
    let callbacks = 0;
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => {
        callbacks++;
        fixture.releaseInitialOwner();
        fixture.failNextFlush = true; // real native invalid-id preflight, not a fabricated failure receipt.
      }
    );
    expect(() => fixture.collector.drain()).toThrow();
    expect(callbacks).toBe(1);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    const debt = fixture.audit();
    expect(debt.version).toBe(before.version);
    expect(debt.retirementEpoch).toBeGreaterThan(before.retirementEpoch);
    expect(
      fixture
        .apiCalls('EditorSession.compatCaptureLeases')
        .some((call) => !call.completed)
    ).toBe(true);
    expect(fixture.collector.drain()).toBe(true);
    expect(callbacks).toBe(1);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    const after = fixture.audit();
    expect(after.retirementEpoch).toBeGreaterThan(debt.retirementEpoch);
    expect(after.retainedCaptures).toBeLessThan(debt.retainedCaptures);
    expect(after.retainedCaptures).toBeLessThanOrEqual(after.liveNodes * 2n);
    fixture.close();
    fixture.proof('post-ack-retry', { before, debt, after, callbacks });
  } finally {
    fixture.close();
  }
});

test('post-ack pending update keeps cleanup debt until its actual discard', () => {
  const fixture = new NativeFixture();
  try {
    fixture.startAndSeed();
    let callbacks = 0;
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => {
        callbacks++;
        fixture.releaseInitialOwner();
        fixture.beginPending();
      }
    );
    expect(fixture.collector.drain()).toBe(false);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    expect(fixture.collector.drain()).toBe(false);
    expect(callbacks).toBe(1);
    fixture.discardPending();
    expect(fixture.collector.drain()).toBe(true);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    expect(callbacks).toBe(1);
    const after = fixture.audit();
    expect(after.retainedCaptures).toBeLessThanOrEqual(after.liveNodes * 2n);
    fixture.close();
    fixture.proof('post-ack-protected', { after, callbacks });
  } finally {
    fixture.close();
  }
});

test('requests reentered after actual retirement do not inherit its acknowledgement', () => {
  const fixture = new NativeFixture();
  try {
    fixture.startAndSeed();
    let oldCallbacks = 0,
      newCallbacks = 0;
    fixture.afterRelease = (version) =>
      fixture.collector.collect(
        version,
        () => false,
        () => newCallbacks++
      );
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => oldCallbacks++
    );
    expect(fixture.collector.drain()).toBe(false);
    expect(oldCallbacks).toBe(1);
    expect(newCallbacks).toBe(0);
    expect(fixture.collector.drain()).toBe(true);
    expect(newCallbacks).toBe(0);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    fixture.close();
    fixture.proof('real-ack-reentry', { oldCallbacks, newCallbacks });
  } finally {
    fixture.close();
  }
});

test('actual preflight rejection preserves a queued retirement until acknowledged retry', () => {
  const fixture = new NativeFixture();
  try {
    fixture.startAndSeed();
    fixture.recorder.setPhase('gc');
    const before = fixture.audit();
    let callbacks = 0;
    fixture.collector.collect(
      fixture.initial.version,
      () => true,
      () => {
        callbacks++;
        fixture.releaseInitialOwner();
      }
    );
    fixture.failNextFlush = true;
    expect(() => fixture.collector.drain()).toThrow();
    const rejected = fixture.audit();
    expect(rejected).toEqual(before);
    expect(callbacks).toBe(0);
    expect(fixture.retired).toEqual([]);
    expect(
      fixture.apiCalls('EditorSession.compatCaptureLeases').at(-1)?.completed
    ).toBe(false);
    expect(fixture.collector.drain()).toBe(true);
    expect(callbacks).toBe(1);
    expect(fixture.retired).toEqual([fixture.initial.version]);
    const after = fixture.audit();
    expect(after.version).toBe(before.version);
    expect(after.retirementEpoch).toBeGreaterThan(before.retirementEpoch);
    fixture.close();
    fixture.proof('actual-preflight-retry', {
      before,
      rejected,
      after,
      callbacks,
    });
  } finally {
    fixture.close();
  }
});
