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
  type ExecutorFailure,
  type ExecutorOptions,
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
