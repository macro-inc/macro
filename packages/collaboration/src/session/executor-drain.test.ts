import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { locks } from 'node:worker_threads';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { LoroDoc } from 'loro-crdt';
import { beforeAll, expect, test, vi } from 'vitest';
import {
  EditorSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { snapshotWriteLock } from '../collab/snapshot-store';
import {
  ABI_MAJOR,
  Access,
  type IStorageOpMsg,
  LocalStateMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from './abi.generated';
import {
  type ExecutorCompletion,
  type ExecutorDrain,
  type ExecutorFailure,
  type ExecutorOptions,
  type ExecutorSettlement,
  SessionExecutor,
} from './executor';
import { emptyInput } from './input';
import { SessionLease } from './lease';
import { ownerLock, StorageAdapter } from './storage';
import { SessionTelemetry } from './telemetry';

beforeAll(() => {
  initSync({
    module: readFileSync(
      new URL(
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    ),
  });
});

function createExecutor(
  hooks: Pick<ExecutorOptions<EditorSession>, 'beforeConsume' | 'afterDrain'>,
  apply: () => void = () => {},
  options: Partial<
    Pick<
      ExecutorOptions<EditorSession>,
      'doc' | 'owner' | 'storage' | 'clock' | 'auth'
    >
  > = {}
) {
  const doc = options.doc ?? `drain-${crypto.randomUUID()}`;
  const owner = options.owner ?? crypto.randomUUID();
  return new SessionExecutor({
    ...hooks,
    doc,
    owner,
    user: 'fixture-user',
    storage: options.storage,
    clock: options.clock,
    locks,
    create: (now, wall) =>
      EditorSession.createMacro(
        ABI_MAJOR,
        SessionConfigMsg.encode({
          doc,
          session: owner,
          user: 'fixture-user',
          peers: [7n, 8n, 9n],
          access: Access.Edit,
          transport: Transport.None,
          durable: false,
          chatter: false,
          headless: false,
          viewEngine: 1,
          viewOs: 0,
          token: '',
          traceparent: '',
          coalesce: 25,
          snapshotInterval: 0,
          observed: [],
        }),
        now,
        wall
      ),
    auth: options.auth ?? {
      token: async () => {
        throw new Error('No transport in drain test');
      },
      subscribe: () => () => {},
    },
    view: { apply },
    socketUrl: () => {
      throw new Error('No transport in drain test');
    },
    telemetry: new SessionTelemetry(NOOP_SPAN),
  });
}

test('native output is fenced before transfer and the outer FIFO drains once', async () => {
  const order: string[] = [];
  const flags: number[] = [];
  const executor = createExecutor(
    {
      beforeConsume: (value) => {
        flags.push(value);
        order.push('before');
      },
      afterDrain: (failure) => {
        expect(failure).toBeUndefined();
        order.push('drained');
      },
    },
    () => order.push('output')
  );
  try {
    executor.run(
      () => {
        order.push('initialize');
        executor.run(
          () => {
            order.push('queued');
            return executor.session.tick(executor.now(), Date.now());
          },
          () => order.push('queued-completion')
        );
        return executor.session.input(
          SessionInputMsg.encode(emptyInput(1)),
          executor.now(),
          Date.now()
        );
      },
      () => order.push('completion')
    );
    expect(flags).toHaveLength(2);
    expect(order).toEqual([
      'initialize',
      'before',
      'output',
      'completion',
      'queued',
      'before',
      'queued-completion',
      'drained',
    ]);
  } finally {
    await executor.close();
  }
});

test.each([undefined, null, { reason: 'opaque' }])(
  'failed close keeps its real lease and pending storage write until durable completion %j',
  async (cause) => {
    const doc = `close-drain-${crypto.randomUUID()}`;
    const owner = crypto.randomUUID();
    const storage = new StorageAdapter(doc, owner, 'fixture-user', locks);
    const barrier = Promise.withResolvers<void>();
    const drain = storage.drain.bind(storage);
    const observeDrain = vi.spyOn(storage, 'drain').mockImplementation(() => {
      const pending = drain();
      barrier.resolve();
      return pending;
    });
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const hold = locks.request(snapshotWriteLock(doc), async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    const source = new LoroDoc();
    source.setPeerId('42');
    source.setRecordTimestamp(false);
    source.getMap('fields').set('value', 'retained');
    source.commit();
    const snapshot = source.export({ mode: 'snapshot' });
    const save: IStorageOpMsg = {
      kind: 8,
      doc,
      owner,
      user: 'fixture-user',
      from: '',
      seq: 0n,
      through: 0n,
      before: 0n,
      retry: false,
      terminal: true,
      record: {
        seq: 0n,
        createdAt: 0n,
        user: '',
        foreign: false,
        quarantined: false,
        delivered: false,
        bytes: new Uint8Array(),
      },
      snapshot,
      coversOwner: '',
      coversSeq: 0n,
      expected: [],
    };
    const write = storage.execute(save);
    let throwCleanup = true;
    const executor = createExecutor(
      {
        afterDrain: () => {
          if (throwCleanup) {
            throwCleanup = false;
            throw cause;
          }
        },
      },
      undefined,
      { doc, owner, storage }
    );
    const free = vi.spyOn(executor.session, 'free');
    const closing = executor.close();
    const result = closing.then(
      () => ({ ok: true, error: undefined }),
      (error) => ({ ok: false, error })
    );
    try {
      expect(executor.close()).toBe(closing);
      expect(
        await Promise.race([
          barrier.promise.then(() => true),
          result.then(() => false),
        ])
      ).toBe(true);
      const before = await locks.query();
      expect(
        before.held?.some((lock) => lock.name === ownerLock(doc, owner))
      ).toBe(true);
      expect(
        before.pending?.some((lock) => lock.name === snapshotWriteLock(doc))
      ).toBe(true);
      expect(free).not.toHaveBeenCalled();
      release.resolve();
      await hold;
      expect(await write).toMatchObject({ kind: 'done', ok: true });
      expect(await result).toEqual({ ok: false, error: cause });
      expect(free).toHaveBeenCalledTimes(1);
      const after = await locks.query();
      expect(
        after.held?.some((lock) => lock.name === ownerLock(doc, owner))
      ).toBe(false);
      const loaded = await storage.execute({ ...save, kind: 0 });
      if (loaded.kind !== 'loaded' || !loaded.payload)
        throw new Error('Stored snapshot missing');
      expect(LocalStateMsg.decode(loaded.payload).snapshot).toEqual(snapshot);
    } finally {
      release.resolve();
      await hold;
      await result;
      free.mockRestore();
      observeDrain.mockRestore();
    }
  }
);

test('a genuinely rejected native Stop fences authorization before releasing its held lease', async () => {
  const doc = `rejected-stop-${crypto.randomUUID()}`;
  const owner = crypto.randomUUID();
  const storage = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const acquired = Promise.withResolvers<void>();
  const allowWrite = Promise.withResolvers<void>();
  const hold = locks.request(snapshotWriteLock(doc), async () => {
    acquired.resolve();
    await allowWrite.promise;
  });
  await acquired.promise;
  const barrier = Promise.withResolvers<void>();
  const originalDrain = storage.drain.bind(storage);
  const drain = vi.spyOn(storage, 'drain').mockImplementation(() => {
    const pending = originalDrain();
    barrier.resolve();
    return pending;
  });
  const snapshot = new LoroDoc();
  snapshot.setPeerId('42');
  snapshot.getMap('fields').set('value', 'pending write');
  snapshot.commit();
  const write = storage.execute({
    kind: 8,
    doc,
    owner,
    user: 'fixture-user',
    from: '',
    seq: 0n,
    through: 0n,
    before: 0n,
    retry: false,
    terminal: true,
    record: {
      seq: 0n,
      createdAt: 0n,
      user: '',
      foreign: false,
      quarantined: false,
      delivered: false,
      bytes: new Uint8Array(),
    },
    snapshot: snapshot.export({ mode: 'snapshot' }),
    coversOwner: '',
    coversSeq: 0n,
    expected: [],
  });
  let invalidClock = false;
  let publish:
    | Parameters<ExecutorOptions<EditorSession>['auth']['subscribe']>[0]
    | undefined;
  let originalFailure: ExecutorFailure | undefined;
  const executor = createExecutor(
    {
      afterDrain: (failure) => {
        if (failure) originalFailure ??= failure;
      },
    },
    undefined,
    {
      doc,
      owner,
      storage,
      clock: { mono: () => 0, wall: () => (invalidClock ? Number.NaN : 0) },
      auth: {
        token: async () => {
          throw new Error('No transport');
        },
        subscribe: (callback) => {
          publish = callback;
          return () => {};
        },
      },
    }
  );
  executor.start();
  executor.run(() =>
    executor.session.input(SessionInputMsg.encode(emptyInput(1)), 0, 0)
  );
  const authorization = vi.spyOn(executor.session, 'authorization');
  const free = vi.spyOn(executor.session, 'free');
  const heldAtRelease: Promise<LockManagerSnapshot>[] = [];
  const accessAtRelease: number[] = [];
  const actualRelease = SessionLease.prototype.release;
  const release = vi
    .spyOn(SessionLease.prototype, 'release')
    .mockImplementation(function (this: SessionLease) {
      invalidClock = false;
      heldAtRelease.push(locks.query());
      publish?.(true, false, false);
      accessAtRelease.push(executor.session.effectiveAccess());
      return actualRelease.call(this);
    });
  invalidClock = true;
  const closing = executor.close();
  const result = closing.then(
    () => ({ ok: true, error: undefined }),
    (error) => ({ ok: false, error })
  );
  try {
    await barrier.promise;
    expect(originalFailure).toBeDefined();
    expect(release).not.toHaveBeenCalled();
    expect(free).not.toHaveBeenCalled();
    allowWrite.resolve();
    await hold;
    expect(await write).toMatchObject({ kind: 'done', ok: true });
    const completed = await result;
    expect(completed.ok).toBe(false);
    expect(completed.error).toBe(originalFailure?.error);
    expect(authorization).not.toHaveBeenCalled();
    expect(accessAtRelease).toEqual([Access.Edit]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(free).toHaveBeenCalledTimes(1);
    for (const state of await Promise.all(heldAtRelease))
      expect(
        state.held?.some((lock) => lock.name === ownerLock(doc, owner))
      ).toBe(true);
    expect(
      (await locks.query()).held?.some(
        (lock) => lock.name === ownerLock(doc, owner)
      )
    ).toBe(false);
  } finally {
    allowWrite.resolve();
    await hold;
    await result;
    release.mockRestore();
    authorization.mockRestore();
    free.mockRestore();
    drain.mockRestore();
  }
});

test.each([undefined, null, { reason: 'opaque' }])(
  'drain cleanup cannot replace an aborted admission cause %j',
  async (cause) => {
    const secondary = { reason: 'cleanup' };
    const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    let cleanupThrows = true;
    const executor = createExecutor({
      afterDrain: () => {
        if (cleanupThrows) throw secondary;
      },
    });
    try {
      let caught = false;
      try {
        executor.runSync(() => {
          throw cause;
        });
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(report).toHaveBeenCalledExactlyOnceWith(secondary, {
        surface: 'session.drain.cleanup',
      });
    } finally {
      cleanupThrows = false;
      report.mockRestore();
      await executor.close();
    }
  }
);

test.each([undefined, null, { reason: 'opaque' }])(
  'aborted native admission retains the original opaque cause %j',
  async (cause) => {
    const failures: (ExecutorFailure | undefined)[] = [];
    let fenced = 0;
    const executor = createExecutor({
      beforeConsume: () => fenced++,
      afterDrain: (failure) => failures.push(failure),
    });
    try {
      let caught = false;
      try {
        executor.runSync(() => {
          throw cause;
        });
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(fenced).toBe(0);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual({ error: cause });
      executor.runSync(() => executor.session.tick(executor.now(), Date.now()));
      expect(fenced).toBe(1);
      expect(failures).toHaveLength(2);
      expect(failures[1]).toBeUndefined();
    } finally {
      await executor.close();
    }
  }
);

// Uses the real native executor; scheduling lifetime proof, not PluginEvent policy proof.
// Scheduling RED only; observer calls below are not claimed native PluginEvent proofs.
test.each([undefined, null, { reason: 'opaque-consume' }])(
  'failed consume invalidates entry observer before afterDrain reentry: %j',
  async (cause) => {
    const order: string[] = [];
    let armed = false;
    let reentered = false;
    let oldSubscribed = false;
    let staleObserved = false;
    let thrown: { error: unknown } | undefined;
    const executor = createExecutor(
      {
        afterDrain: (failure) => {
          if (!armed || reentered || !failure) return;
          reentered = true;
          order.push('afterDrain-reentry');
          // Actual second entry executes while the legacy caller finally has not run.
          executor.runSync(() => {
            if (oldSubscribed) staleObserved = true;
            order.push('second-native-call');
            return executor.session.input(
              SessionInputMsg.encode(emptyInput(1)),
              executor.now(),
              Date.now()
            );
          });
        },
      },
      () => {
        if (armed && !reentered) {
          order.push('consume-throws');
          throw cause;
        }
      }
    );
    try {
      armed = true;
      try {
        oldSubscribed = true;
        try {
          executor.tryRunSync(
            () =>
              executor.session.input(
                SessionInputMsg.encode(emptyInput(1)),
                executor.now(),
                Date.now()
              ),
            undefined,
            () => {
              oldSubscribed = false;
            }
          );
        } finally {
          oldSubscribed = false;
          order.push('caller-unsubscribe');
        }
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toBeDefined();
      expect(thrown?.error).toBe(cause);
      expect(order).toEqual([
        'consume-throws',
        'afterDrain-reentry',
        'second-native-call',
        'caller-unsubscribe',
      ]);
      // Baseline RED: legacy caller-finally is later than actual reentry.
      expect(staleObserved).toBe(false);
    } finally {
      armed = false;
      await executor.close();
    }
  }
);

test.each([undefined, null, { reason: 'opaque-entry' }])(
  'sync terminal covers receiver, beforeConsume, consume and after faults: %j',
  async (cause) => {
    for (const phase of [
      'receiver',
      'beforeConsume',
      'consume',
      'after',
    ] as const) {
      let armed = false;
      let reentered = false;
      let active = false;
      let stale = 0;
      let healthy = 0;
      const order: string[] = [];
      let primary: { error: unknown } | undefined;
      const executor = createExecutor(
        {
          beforeConsume: () => {
            if (armed && !reentered && phase === 'beforeConsume') throw cause;
          },
          afterDrain: (failure) => {
            if (!armed || reentered || !failure) return;
            reentered = true;
            order.push('reentry');
            executor.runSync(() =>
              executor.session.input(
                SessionInputMsg.encode(emptyInput(1)),
                executor.now(),
                Date.now()
              )
            );
          },
        },
        () => {
          if (armed && !reentered && phase === 'consume') throw cause;
          if (reentered && active) stale++;
        }
      );
      try {
        armed = true;
        try {
          executor.tryRunSync(
            () => {
              active = true;
              if (phase === 'receiver') throw cause;
              return executor.session.input(
                SessionInputMsg.encode(emptyInput(1)),
                executor.now(),
                Date.now()
              );
            },
            () => {
              if (phase === 'after') throw cause;
            },
            () => {
              active = false;
              order.push('terminal');
            }
          );
        } catch (error) {
          primary = { error };
        }
        expect(primary).toBeDefined();
        expect(primary?.error).toBe(cause);
        expect(order).toEqual(['terminal', 'reentry']);
        expect(stale).toBe(0);
        armed = false;
        expect(
          executor.tryRunSync(
            () =>
              executor.session.input(
                SessionInputMsg.encode(emptyInput(1)),
                executor.now(),
                Date.now()
              ),
            () => healthy++,
            () => {}
          )
        ).toEqual({ status: 'completed' });
        expect(healthy).toBe(1);
      } finally {
        armed = false;
        await executor.close();
      }
    }
  }
);

test('sync busy refusal is typed and performs no factory, after or finish', async () => {
  const executor = createExecutor({});
  let calls = 0;
  let after = 0;
  let finish = 0;
  try {
    executor.runSync(() => {
      expect(
        executor.tryRunSync(
          () => {
            calls++;
            return executor.session.tick(executor.now(), Date.now());
          },
          () => after++,
          () => finish++
        )
      ).toEqual({
        status: 'refused',
        reason: 'busy-queued',
      });
      expect(() =>
        executor.runSync(() =>
          executor.session.tick(executor.now(), Date.now())
        )
      ).toThrow('busy');
      return executor.session.tick(executor.now(), Date.now());
    });
    expect([calls, after, finish]).toEqual([0, 0, 0]);
    await executor.close();
    expect(() =>
      executor.tryRunSync(
        () => {
          calls++;
          return executor.session.tick(executor.now(), Date.now());
        },
        undefined,
        () => finish++
      )
    ).toThrow('closed');
    expect([calls, after, finish]).toEqual([0, 0, 0]);
  } finally {
    await executor.close();
  }
});

test.each([undefined, null, { reason: 'opaque-primary' }])(
  'sync finish and telemetry faults cannot replace the primary %j',
  async (cause) => {
    const cleanup = { reason: 'unsubscribe' };
    const reporter = { reason: 'reporter' };
    let active = false;
    let stale = false;
    let reentered = false;
    let armed = false;
    let primary: { error: unknown } | undefined;
    let restoreReport = () => {};
    const executor = createExecutor(
      {
        afterDrain: (failure) => {
          if (!armed || reentered || !failure) return;
          reentered = true;
          executor.runSync(() => {
            stale = active;
            return executor.session.input(
              SessionInputMsg.encode(emptyInput(1)),
              executor.now(),
              Date.now()
            );
          });
        },
      },
      () => {
        if (armed && !reentered) throw cause;
      }
    );
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {
        throw reporter;
      });
      restoreReport = () => report.mockRestore();
      armed = true;
      try {
        executor.tryRunSync(
          () => {
            active = true;
            return executor.session.input(
              SessionInputMsg.encode(emptyInput(1)),
              executor.now(),
              Date.now()
            );
          },
          undefined,
          () => {
            active = false;
            throw cleanup;
          }
        );
      } catch (error) {
        primary = { error };
      }
      expect(primary).toBeDefined();
      expect(primary?.error).toBe(cause);
      expect(report).toHaveBeenCalledExactlyOnceWith(cleanup, {
        surface: 'session.sync-entry.cleanup',
      });
      expect(reentered).toBe(true);
      expect(stale).toBe(false);
      armed = false;
      let healthy = 0;
      expect(
        executor.tryRunSync(
          () =>
            executor.session.input(
              SessionInputMsg.encode(emptyInput(1)),
              executor.now(),
              Date.now()
            ),
          () => healthy++,
          () => {}
        )
      ).toEqual({ status: 'completed' });
      expect(healthy).toBe(1);
    } finally {
      armed = false;
      try {
        restoreReport();
      } finally {
        await executor.close();
      }
    }
  }
);

// Real synchronous SettledEntry ownership, not native publication/semantic evidence.
test.each([undefined, null, { opaque: 'owned-completion' }])(
  'sync drain partitions actual started entries and fences late completion failure %j',
  async (cause) => {
    let armed = false;
    let reentered = false;
    let outer: ExecutorCompletion | undefined;
    let inner: ExecutorCompletion | undefined;
    const executor = createExecutor({
      afterDrain: (_, drain) => {
        if (!armed || !drain) return;
        if (!reentered) {
          reentered = true;
          if (!outer) throw new Error('Missing actual outer completion');
          expect(outer.running).toBe(false);
          expect(drain.ownsCompletion(outer)).toBe(true);
          executor.tryRunSync(
            (completion) => {
              inner = completion;
              expect(completion.running).toBe(true);
              return executor.session.tick(executor.now(), Date.now());
            },
            undefined,
            () => {
              expect(inner?.running).toBe(true);
            }
          );
          if (!inner) throw new Error('Missing actual inner completion');
          expect(drain.ownsCompletion(inner)).toBe(false);
          outer.fail(cause);
        } else {
          if (!inner || !outer) throw new Error('Missing real completions');
          expect(drain.ownsCompletion(inner)).toBe(true);
          expect(drain.ownsCompletion(outer)).toBe(false);
        }
      },
    });
    try {
      armed = true;
      let thrown: ExecutorFailure | undefined;
      try {
        executor.tryRunSync(
          (completion) => {
            outer = completion;
            expect(completion.running).toBe(true);
            return executor.session.tick(executor.now(), Date.now());
          },
          undefined,
          () => {
            expect(outer?.running).toBe(true);
          }
        );
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toBeDefined();
      expect(thrown?.error).toBe(cause);
      expect(reentered).toBe(true);
      expect(outer?.running).toBe(false);
      expect(inner?.running).toBe(false);
      expect(() => outer?.fail('late')).toThrow('already delivered');
      expect(() => inner?.fail('late')).toThrow('already delivered');
      armed = false;
      expect(
        executor.tryRunSync(
          () => executor.session.tick(executor.now(), Date.now()),
          undefined,
          () => {}
        )
      ).toEqual({ status: 'completed' });
    } finally {
      armed = false;
      await executor.close();
    }
  }
);

test.each([undefined, null, { opaque: 'legacy-entry' }])(
  'mixed actual owned and queued legacy work shares only its creation drain %j',
  async (cause) => {
    let armed = false;
    let frame: ExecutorDrain | undefined;
    let completion: ExecutorCompletion | undefined;
    let afterDrain = 0;
    const executor = createExecutor({
      afterDrain: (failure, drain) => {
        if (!armed) return;
        afterDrain++;
        expect(drain).toBe(frame);
        expect(executor.runningDrain).toBe(frame);
        expect(failure).toBeDefined();
        expect(failure?.error).toBe(cause);
        if (!completion || !drain) throw new Error('Missing real owned drain');
        expect(drain.ownsCompletion(completion)).toBe(true);
        expect(completion.running).toBe(false);
      },
    });
    try {
      armed = true;
      let thrown: ExecutorFailure | undefined;
      try {
        executor.tryRunSync(
          (actual) => {
            completion = actual;
            frame = executor.runningDrain;
            expect(frame).toBeDefined();
            expect(Object.isFrozen(frame)).toBe(true);
            expect(frame?.ownsCompletion(actual)).toBe(true);
            executor.run(() => {
              expect(executor.runningDrain).toBe(frame);
              expect(actual.running).toBe(false);
              throw cause;
            });
            return executor.session.tick(executor.now(), Date.now());
          },
          undefined,
          () => {
            expect(executor.runningDrain).toBe(frame);
            expect(completion?.running).toBe(true);
          }
        );
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toBeDefined();
      expect(thrown?.error).toBe(cause);
      expect(afterDrain).toBe(1);
      expect(executor.runningDrain).toBeUndefined();
      expect(completion?.running).toBe(false);
      expect(() => completion?.fail('late')).toThrow('already delivered');
      armed = false;
      expect(
        executor.tryRunSync(
          () => executor.session.tick(executor.now(), Date.now()),
          undefined,
          () => {}
        )
      ).toEqual({ status: 'completed' });
      expect(executor.runningDrain).toBeUndefined();
    } finally {
      armed = false;
      await executor.close();
    }
  }
);

test('legacy-only drain has an actual immutable fence without a manufactured completion', async () => {
  let armed = false;
  let frame: ExecutorDrain | undefined;
  let historical: ExecutorCompletion | undefined;
  const executor = createExecutor({
    afterDrain: (_, drain) => {
      if (!armed) return;
      expect(drain).toBe(frame);
      expect(executor.runningDrain).toBe(frame);
      if (!historical || !drain) throw new Error('Missing historical control');
      expect(drain.ownsCompletion(historical)).toBe(false);
    },
  });
  try {
    executor.tryRunSync(
      (completion) => {
        historical = completion;
        return executor.session.tick(executor.now(), Date.now());
      },
      undefined,
      () => {}
    );
    armed = true;
    executor.run(() => {
      frame = executor.runningDrain;
      expect(frame).toBeDefined();
      expect(Object.isFrozen(frame)).toBe(true);
      executor.run(() => {
        expect(executor.runningDrain).toBe(frame);
        return executor.session.tick(executor.now(), Date.now());
      });
      return executor.session.tick(executor.now(), Date.now());
    });
    expect(executor.runningDrain).toBeUndefined();
  } finally {
    armed = false;
    await executor.close();
  }
});

test.each([undefined, null, { opaque: 'drain-callback' }])(
  'afterDrain and settlement reentry restore the actual outer fence through callback faults %j',
  async (cause) => {
    let phase: 'idle' | 'outer' | 'after-drain' | 'settlement' = 'idle';
    let outer: ExecutorDrain | undefined;
    const nested: ExecutorDrain[] = [];
    let settlementResult: ExecutorSettlement | undefined;
    let settlementBefore: ExecutorDrain | undefined;
    let settlementAfter: ExecutorDrain | undefined;
    const executor = createExecutor({
      afterDrain: (_, drain) => {
        if (phase === 'idle') return;
        expect(executor.runningDrain).toBe(drain);
        if (phase !== 'outer') {
          expect(drain).not.toBe(outer);
          if (!drain) throw new Error('Missing nested drain');
          nested.push(drain);
          return;
        }
        expect(drain).toBe(outer);
        phase = 'after-drain';
        executor.runSync(() => {
          expect(executor.runningDrain).not.toBe(outer);
          return executor.session.tick(executor.now(), Date.now());
        });
        expect(executor.runningDrain).toBe(outer);
        phase = 'outer';
        throw cause;
      },
    });
    try {
      phase = 'outer';
      let thrown: ExecutorFailure | undefined;
      try {
        executor.runSettled(
          () => {
            outer = executor.runningDrain;
            expect(outer).toBeDefined();
            return executor.session.tick(executor.now(), Date.now());
          },
          (result) => {
            settlementBefore = executor.runningDrain;
            settlementResult = result;
            phase = 'settlement';
            executor.runSync(() => {
              expect(executor.runningDrain).not.toBe(outer);
              return executor.session.tick(executor.now(), Date.now());
            });
            settlementAfter = executor.runningDrain;
            phase = 'outer';
          }
        );
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toBeDefined();
      expect(thrown?.error).toBe(cause);
      expect(settlementBefore).toBe(outer);
      expect(settlementAfter).toBe(outer);
      expect(settlementResult).toBeDefined();
      expect(settlementResult?.status).toBe('error');
      if (settlementResult?.status === 'error')
        expect(settlementResult.error).toBe(cause);
      expect(nested).toHaveLength(2);
      expect(nested[0]).not.toBe(nested[1]);
      expect(executor.runningDrain).toBeUndefined();
      phase = 'idle';
      executor.runSync(() => executor.session.tick(executor.now(), Date.now()));
      expect(executor.runningDrain).toBeUndefined();
    } finally {
      phase = 'idle';
      await executor.close();
    }
  }
);

test.each([undefined, null, { opaque: 'finish-only' }])(
  'real sync finish failure settles error and the next actual input is healthy %j',
  async (cause) => {
    const executor = createExecutor({});
    let completion: ExecutorCompletion | undefined;
    let after = 0;
    let finish = 0;
    let restoreReport = () => {};
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
      restoreReport = () => report.mockRestore();
      let caught: ExecutorFailure | undefined;
      try {
        executor.tryRunSync(
          (actual) => {
            completion = actual;
            return executor.session.input(
              SessionInputMsg.encode(emptyInput(1)),
              executor.now(),
              Date.now()
            );
          },
          () => after++,
          () => {
            finish++;
            expect(completion?.running).toBe(true);
            throw cause;
          }
        );
      } catch (error) {
        caught = { error };
      }
      expect(after).toBe(1);
      expect(finish).toBe(1);
      expect(caught).toBeDefined();
      expect(caught?.error).toBe(cause);
      expect(completion?.running).toBe(false);
      expect(() => completion?.failSecondary('late')).toThrow(
        'already delivered'
      );
      expect(report).toHaveBeenCalledExactlyOnceWith(cause, {
        surface: 'session.sync-entry.cleanup',
      });
      expect(
        executor.tryRunSync(
          () => executor.session.tick(executor.now(), Date.now()),
          () => after++,
          () => finish++
        )
      ).toEqual({ status: 'completed' });
      expect(after).toBe(2);
      expect(finish).toBe(2);
      expect(executor.runningDrain).toBeUndefined();
    } finally {
      try {
        restoreReport();
      } finally {
        await executor.close();
      }
    }
  }
);
