/** @vitest-environment jsdom */
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createInputCommitObservation } from './input-commit-observation';
import {
  commitApplication,
  initializeInputCommitFixture,
  mountInputCommitFixture,
  native,
  seedInputCommitFixture,
} from './input-commit-test-fixture';

let restore: (() => void) | undefined;
let trace: string[] = [];
let nativeFailure: { error: unknown } | undefined;
function capturedNativeFailure() {
  return nativeFailure;
}
beforeAll(() => {
  restore = initializeInputCommitFixture();
  // Instrument real generated functions before the permanent module guard.
  // Every spy delegates; no flags, receipts, scopes or outputs are fabricated.
  const input = native.EditorSession.prototype.inputObserved;
  vi.spyOn(native.EditorSession.prototype, 'inputObserved').mockImplementation(
    function (this: native.EditorSession, ...args: Parameters<typeof input>) {
      trace.push('input.enter');
      try {
        return input.call(this, ...args);
      } catch (error) {
        nativeFailure = { error };
        throw error;
      } finally {
        trace.push('input.leave');
      }
    }
  );
  const read = native.EditorSession.prototype.readInputCommitReceipt;
  vi.spyOn(
    native.EditorSession.prototype,
    'readInputCommitReceipt'
  ).mockImplementation(function (
    this: native.EditorSession,
    ...args: Parameters<typeof read>
  ) {
    trace.push('receipt.read');
    const result = read.call(this, ...args);
    trace.push('receipt.read.return');
    return result;
  });
  const release = native.InputCommitReceipt.prototype.free;
  vi.spyOn(native.InputCommitReceipt.prototype, 'free').mockImplementation(
    function (this: native.InputCommitReceipt) {
      trace.push('receipt.free');
      release.call(this);
      trace.push('receipt.free.return');
    }
  );
  const take = native.EditorSession.prototype.takeOutput;
  vi.spyOn(native.EditorSession.prototype, 'takeOutput').mockImplementation(
    function (this: native.EditorSession) {
      trace.push('takeOutput');
      const result = take.call(this);
      trace.push('takeOutput.return');
      return result;
    }
  );
  const free = native.EditorSession.prototype.free;
  vi.spyOn(native.EditorSession.prototype, 'free').mockImplementation(function (
    this: native.EditorSession
  ) {
    trace.push('session.free');
    free.call(this);
    trace.push('session.free.return');
  });
  const unregister = native.EditorSession.prototype.unregisterViewEnter;
  vi.spyOn(
    native.EditorSession.prototype,
    'unregisterViewEnter'
  ).mockImplementation(function (
    this: native.EditorSession,
    ...args: Parameters<typeof unregister>
  ) {
    trace.push('key.unregister');
    return unregister.call(this, ...args);
  });
});
afterAll(() => {
  // Do not restore receiver descriptors beneath a permanent installed guard.
  // This isolated test module owns its instrumentation for its entire lifetime.
  restore?.();
});

for (const action of ['keep', 'close', 'dispose']) {
  for (const error of [undefined, null, { kind: 'observer error' }]) {
    test(`actual copied receipt precedes ${action} observer and opaque ${String(error)}`, async () => {
      const runtime = mountInputCommitFixture();
      let closing: Promise<void> | undefined;
      try {
        await seedInputCommitFixture(runtime);
        const run = runtime.executor.runSettled.bind(runtime.executor);
        vi.spyOn(runtime.executor, 'runSettled').mockImplementation(
          (call, notify, options) =>
            run(
              call,
              (settled) => {
                trace.push('settlement.notified');
                notify(settled);
              },
              options
            )
        );
        trace = [];
        const refusals: { error: unknown }[] = [];
        let inListener: unknown;
        const observed = createInputCommitObservation((evidence) => {
          trace.push('observer');
          inListener = observed.read();
          // No issued Rust scope is fabricated for this synchronous pure lane.
          for (const attempt of [
            () => runtime.executor.session.serializedState(),
            () =>
              runtime.executor.session.tick(runtime.executor.now(), Date.now()),
            () => runtime.executor.session.free(),
            () =>
              runtime.executor.session.inputObserved(
                new Uint8Array(),
                runtime.executor.now(),
                Date.now(),
                '999'
              ),
          ]) {
            try {
              attempt();
            } catch (error) {
              refusals.push({ error });
            }
          }
          if (action === 'dispose') runtime.view.dispose();
          if (action !== 'keep') {
            trace.push('close.request');
            closing = runtime.close();
          }
          if (evidence.status !== 'published')
            throw new Error('No actual copied main evidence');
          throw error;
        });
        const settled = await runtime.port.inputSettled(
          () => commitApplication(runtime),
          { mainCommit: observed }
        );
        expect(settled.status).toBe('error');
        if (settled.status !== 'error')
          throw new Error('Expected observer failure settlement');
        expect(settled.error).toBe(error);
        expect(Object.hasOwn(settled, 'error')).toBe(true);
        expect(observed.read()).toBe(inListener);
        expect(settled.mainCommit).toBe(inListener);
        expect(inListener).toMatchObject({
          status: 'published',
          mainHandled: true,
        });
        expect(refusals).toHaveLength(4);
        for (const refusal of refusals)
          expect(refusal.error).toBeInstanceOf(Error);
        expect(trace.filter((x) => x === 'input.enter')).toHaveLength(1);
        expect(trace.filter((x) => x === 'receipt.free.return')).toHaveLength(
          1
        );
        expect(trace.indexOf('receipt.read.return')).toBeLessThan(
          trace.indexOf('receipt.free.return')
        );
        expect(trace.indexOf('receipt.free.return')).toBeLessThan(
          trace.indexOf('observer')
        );
        expect(trace.indexOf('observer')).toBeLessThan(
          trace.indexOf('takeOutput')
        );
        expect(trace.indexOf('takeOutput.return')).toBeLessThan(
          trace.indexOf('settlement.notified')
        );
        if (closing) {
          await closing;
          expect(trace.lastIndexOf('takeOutput.return')).toBeLessThan(
            trace.indexOf('session.free')
          );
          expect(trace.indexOf('settlement.notified')).toBeLessThan(
            trace.indexOf('session.free')
          );
          expect(trace.filter((x) => x === 'session.free.return')).toHaveLength(
            1
          );
        } else {
          // The optional listener failure is entry-local, not permanent native debt.
          expect(
            runtime.port.query({ kind: 3, key: 0, flags: 0, text: '' }).count
          ).toBeGreaterThan(0);
          const nextObservation = createInputCommitObservation();
          const next = await runtime.port.inputSettled(
            () => commitApplication(runtime, '"italic"'),
            { mainCommit: nextObservation }
          );
          expect(next.status).toBe('success');
          const before = observed.read(),
            after = nextObservation.read();
          if (before.status !== 'published' || after.status !== 'published')
            throw new Error('Expected actual main receipts');
          expect(after.entryId).toBe(before.entryId + 1n);
        }
      } finally {
        await runtime.close();
        runtime.root.remove();
      }
    });
  }
}

test('a real after-hook opaque error wins over an optional listener failure', async () => {
  const runtime = mountInputCommitFixture();
  const observerError = { kind: 'secondary observer' };
  const observed = createInputCommitObservation(() => {
    throw observerError;
  });
  let caught: { error: unknown } | undefined;
  try {
    await seedInputCommitFixture(runtime);
    try {
      await runtime.port.inputSettled(() => commitApplication(runtime), {
        mainCommit: observed,
        after() {
          throw undefined;
        },
      });
    } catch (error) {
      caught = { error };
    }
    expect(caught).toEqual({ error: undefined });
    expect(observed.read()).toMatchObject({
      status: 'published',
      mainHandled: true,
    });
    expect(runtime.executor.session.serializedState()).toContain('"format":1');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('real native generation rejection copies NoPub and drains close before free without flags', async () => {
  const runtime = mountInputCommitFixture();
  let closing: Promise<void> | undefined;
  const observed = createInputCommitObservation(() => {
    trace.push('observer');
    closing = runtime.close();
    throw undefined;
  });
  let after = 0;
  let caught: { error: unknown } | undefined;
  try {
    await seedInputCommitFixture(runtime);
    trace = [];
    nativeFailure = undefined;
    try {
      await runtime.port.inputSettled(
        () => {
          const input = commitApplication(runtime);
          return { ...input, generation: input.generation + 1 };
        },
        {
          mainCommit: observed,
          after() {
            after++;
          },
        }
      );
    } catch (error) {
      caught = { error };
    }
    const original = capturedNativeFailure();
    expect(original).toBeDefined();
    expect(caught?.error).toBe(original?.error);
    expect(after).toBe(0);
    expect(observed.read().status).toBe('not-published');
    expect(trace.indexOf('receipt.free.return')).toBeLessThan(
      trace.indexOf('observer')
    );
    await closing;
    expect(trace.filter((x) => x === 'takeOutput.return')).toHaveLength(1);
    expect(trace.indexOf('takeOutput.return')).toBeLessThan(
      trace.indexOf('session.free')
    );
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const otherOwner of [false, true]) {
  test(`actual ${otherOwner ? 'other' : 'same'} owner key release follows copied receipt and pure return`, async () => {
    const runtime = mountInputCommitFixture();
    const other = otherOwner ? mountInputCommitFixture() : undefined;
    let release: (() => void) | undefined;
    try {
      await seedInputCommitFixture(runtime);
      if (other) await seedInputCommitFixture(other);
      const keys = (other ?? runtime).port.nativeEnter;
      if (!keys) throw new Error('Missing actual ordered key port');
      release = keys.register(() => true, 3);
      let during = -1;
      const observed = createInputCommitObservation(() => {
        trace.push('observer');
        release?.();
        during = trace.filter((x) => x === 'key.unregister').length;
      });
      trace = [];
      const result = await runtime.port.inputSettled(
        () => commitApplication(runtime),
        { mainCommit: observed }
      );
      expect(result.status).toBe('success');
      expect(during).toBe(0);
      expect(trace.filter((x) => x === 'key.unregister')).toHaveLength(1);
      expect(trace.indexOf('receipt.free.return')).toBeLessThan(
        trace.indexOf('observer')
      );
      expect(trace.indexOf('observer')).toBeLessThan(
        trace.indexOf('key.unregister')
      );
    } finally {
      release?.();
      await runtime.close();
      runtime.root.remove();
      if (other) {
        await other.close();
        other.root.remove();
      }
    }
  });
}
