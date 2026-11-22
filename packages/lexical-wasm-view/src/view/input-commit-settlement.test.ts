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
let observedEntries = 0;
beforeAll(() => {
  restore = initializeInputCommitFixture();
  const actual = native.EditorSession.prototype.inputObserved;
  vi.spyOn(native.EditorSession.prototype, 'inputObserved').mockImplementation(
    function (this: native.EditorSession, ...args: Parameters<typeof actual>) {
      observedEntries++;
      return actual.call(this, ...args);
    }
  );
});
afterAll(() => restore?.());

test('missing real observer lifetime binding refuses before claim or factory', async () => {
  const runtime = mountInputCommitFixture(false);
  const observed = createInputCommitObservation();
  let factories = 0;
  try {
    await seedInputCommitFixture(runtime);
    expect(() =>
      runtime.port.inputSettled(
        () => {
          factories++;
          return commitApplication(runtime);
        },
        { mainCommit: observed }
      )
    ).toThrow('lifetime fence');
    expect(factories).toBe(0);
    expect(observed.read().status).toBe('unbound');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('queued caller cancellation captures options once, without observed receiver or notification', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    const authority = vi.spyOn(runtime.executor.session, 'effectiveAccess');
    let current = true,
      factories = 0,
      notifications = 0,
      after = 0;
    let admitReads = 0,
      afterReads = 0,
      observationReads = 0;
    const observed = createInputCommitObservation(() => {
      notifications++;
    });
    const options = {
      get admit() {
        admitReads++;
        return () => current;
      },
      get after() {
        afterReads++;
        return () => {
          after++;
        };
      },
      get mainCommit() {
        observationReads++;
        return observed;
      },
    };
    let pending:
      | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
      | undefined;
    observedEntries = 0;
    runtime.executor.run(() => {
      pending = runtime.port.inputSettledIfSessionEdit(() => {
        factories++;
        return commitApplication(runtime);
      }, options);
      current = false;
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(await pending).toMatchObject({
      status: 'cancelled',
      reason: 'entry-admission',
      mainCommit: {
        status: 'not-entered',
        cause: { status: 'cancelled', reason: 'entry-admission' },
      },
    });
    expect(authority).toHaveBeenCalledTimes(1);
    expect([admitReads, afterReads, observationReads]).toEqual([1, 1, 1]);
    expect([factories, notifications, after, observedEntries]).toEqual([
      0, 0, 0, 0,
    ]);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('real Session access refusal skips predicate; regrant permits UI-readonly programmatic observation', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    const denied = createInputCommitObservation();
    let pending:
      | ReturnType<typeof runtime.port.inputSettledIfSessionEdit>
      | undefined;
    let predicates = 0,
      factories = 0;
    observedEntries = 0;
    runtime.executor.run(() => {
      pending = runtime.port.inputSettledIfSessionEdit(
        () => {
          factories++;
          return commitApplication(runtime);
        },
        {
          mainCommit: denied,
          admit() {
            predicates++;
            return true;
          },
        }
      );
      return runtime.executor.session.authorization(
        true,
        false,
        false,
        runtime.executor.now(),
        Date.now()
      );
    });
    expect(await pending).toMatchObject({
      status: 'cancelled',
      reason: 'session-access',
      mainCommit: { status: 'not-entered' },
    });
    expect([predicates, factories, observedEntries]).toEqual([0, 0, 0]);
    runtime.executor.run(() =>
      runtime.executor.session.authorization(
        true,
        true,
        true,
        runtime.executor.now(),
        Date.now()
      )
    );
    runtime.view.setEditable(false);
    const allowed = createInputCommitObservation();
    const result = await runtime.port.inputSettledIfSessionEdit(
      () => commitApplication(runtime),
      { mainCommit: allowed, admit: () => true }
    );
    expect(result).toMatchObject({
      status: 'success',
      handled: true,
      mainCommit: { status: 'published', mainHandled: true },
    });
    expect(runtime.view.isEditable).toBe(false);
    expect(observedEntries).toBe(1);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('atomic claim rejects queued reuse before factory or correlation and notifies once', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    let factories = 0,
      notifications = 0;
    const observed = createInputCommitObservation(() => {
      notifications++;
    });
    let pending: ReturnType<typeof runtime.port.inputSettled> | undefined;
    observedEntries = 0;
    runtime.executor.run(() => {
      pending = runtime.port.inputSettled(
        () => {
          factories++;
          return commitApplication(runtime);
        },
        { mainCommit: observed }
      );
      expect(observed.read().status).toBe('pending');
      expect(() =>
        runtime.port.inputSettled(
          () => {
            factories++;
            return commitApplication(runtime);
          },
          { mainCommit: observed }
        )
      ).toThrow('already claimed');
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(await pending).toMatchObject({ status: 'success', handled: true });
    expect([factories, notifications, observedEntries]).toEqual([1, 1, 1]);
    expect(() =>
      runtime.port.inputSettled(() => commitApplication(runtime), {
        mainCommit: observed,
      })
    ).toThrow('already claimed');
    expect(observedEntries).toBe(1);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

for (const error of [undefined, null, { kind: 'factory failure' }]) {
  test(`own opaque ${String(error)} factory failure retains later accepted FIFO and pending observation`, async () => {
    const runtime = mountInputCommitFixture();
    const failed = createInputCommitObservation();
    const later = createInputCommitObservation();
    let firstResult: ReturnType<typeof runtime.port.inputSettled> | undefined;
    let laterResult: ReturnType<typeof runtime.port.inputSettled> | undefined;
    let caught: { error: unknown } | undefined;
    try {
      await seedInputCommitFixture(runtime);
      observedEntries = 0;
      try {
        runtime.executor.run(() => {
          firstResult = runtime.port.inputSettled(
            () => {
              throw error;
            },
            { mainCommit: failed }
          );
          laterResult = runtime.port.inputSettled(
            () => commitApplication(runtime),
            { mainCommit: later }
          );
          return runtime.executor.session.tick(
            runtime.executor.now(),
            Date.now()
          );
        });
      } catch (error) {
        caught = { error };
      }
      expect(caught).toEqual({ error });
      expect(await firstResult).toMatchObject({
        status: 'error',
        error,
        mainCommit: {
          status: 'not-entered',
          cause: { status: 'error', error },
        },
      });
      expect(observedEntries).toBe(0);
      expect(later.read().status).toBe('pending');
      runtime.executor.run(() =>
        runtime.executor.session.tick(runtime.executor.now(), Date.now())
      );
      expect(await laterResult).toMatchObject({
        status: 'success',
        handled: true,
      });
      expect(observedEntries).toBe(1);
      expect(later.read()).toMatchObject({
        status: 'published',
        mainHandled: true,
      });
      if (typeof error === 'object' && error !== null)
        expect(Object.isFrozen(error)).toBe(false);
    } finally {
      await runtime.close();
      runtime.root.remove();
    }
  });
}
