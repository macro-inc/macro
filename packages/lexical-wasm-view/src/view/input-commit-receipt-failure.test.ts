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
let getterFault: { error: unknown } | undefined;
let freeFault: { before: boolean; error: unknown } | undefined;
let releaseAttempts = 0;
let actualReleases = 0;
let retained: native.InputCommitReceipt | undefined;
let actualRelease: typeof native.InputCommitReceipt.prototype.free;
beforeAll(() => {
  restore = initializeInputCommitFixture();
  const read = Object.getOwnPropertyDescriptor(
    native.InputCommitReceipt.prototype,
    'entryId'
  )?.get;
  if (!read) throw new Error('Missing actual receipt getter');
  vi.spyOn(
    native.InputCommitReceipt.prototype,
    'entryId',
    'get'
  ).mockImplementation(function (this: native.InputCommitReceipt) {
    const value: unknown = Reflect.apply(read, this, []);
    if (getterFault !== undefined) throw getterFault.error;
    if (typeof value !== 'bigint')
      throw new Error('Actual receipt returned a non-bigint');
    return value;
  });
  actualRelease = native.InputCommitReceipt.prototype.free;
  vi.spyOn(native.InputCommitReceipt.prototype, 'free').mockImplementation(
    function (this: native.InputCommitReceipt) {
      releaseAttempts++;
      if (freeFault?.before) {
        retained = this;
        throw freeFault.error;
      }
      actualRelease.call(this);
      actualReleases++;
      if (freeFault !== undefined) throw freeFault.error;
    }
  );
});
afterAll(() => restore?.());

for (const error of [undefined, null, { kind: 'getter failure' }]) {
  test(`actual getter failure ${String(error)} still releases and never invents NotPublished`, async () => {
    const runtime = mountInputCommitFixture();
    try {
      await seedInputCommitFixture(runtime);
      getterFault = { error };
      releaseAttempts = 0;
      actualReleases = 0;
      let notifications = 0;
      const observed = createInputCommitObservation(() => {
        notifications++;
      });
      const result = await runtime.port.inputSettled(
        () => commitApplication(runtime),
        { mainCommit: observed }
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error')
        throw new Error('Expected getter error settlement');
      expect(result.error).toBe(error);
      expect(observed.read()).toMatchObject({
        status: 'unavailable',
        reason: 'receipt-read',
        receiverNeverCalled: false,
        failure: { error },
      });
      expect(releaseAttempts).toBe(1);
      expect(actualReleases).toBe(1);
      expect(notifications).toBe(1);
      expect(runtime.executor.session.serializedState()).toContain(
        '"format":1'
      );
    } finally {
      getterFault = undefined;
      await runtime.close();
      runtime.root.remove();
    }
  });
}

for (const before of [true, false]) {
  for (const error of [undefined, null, { kind: 'release failure' }]) {
    test(`release failure ${String(error)} ${before ? 'before' : 'after'} actual free keeps copied publication`, async () => {
      const runtime = mountInputCommitFixture();
      try {
        await seedInputCommitFixture(runtime);
        freeFault = { before, error };
        releaseAttempts = 0;
        actualReleases = 0;
        let notifications = 0;
        const observed = createInputCommitObservation(() => {
          notifications++;
        });
        const result = await runtime.port.inputSettled(
          () => commitApplication(runtime),
          { mainCommit: observed }
        );
        expect(result.status).toBe('error');
        if (result.status !== 'error')
          throw new Error('Expected release error settlement');
        expect(result.error).toBe(error);
        expect(observed.read()).toMatchObject({
          status: 'published',
          mainHandled: true,
        });
        expect(releaseAttempts).toBe(1);
        expect(actualReleases).toBe(before ? 0 : 1);
        expect(notifications).toBe(0);
        expect(runtime.executor.session.serializedState()).toContain(
          '"format":1'
        );
      } finally {
        freeFault = undefined;
        // Fault-before-free leaves a real primitive lease in this fixture.
        // Clean it with the original generated destructor, never retry in Port.
        if (retained) {
          actualRelease.call(retained);
          retained = undefined;
        }
        await runtime.close();
        runtime.root.remove();
      }
    });
  }
}
