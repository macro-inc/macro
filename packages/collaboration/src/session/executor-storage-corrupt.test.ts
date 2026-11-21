import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { locks } from 'node:worker_threads';
import { NOOP_SPAN } from '@macro-inc/observability';
import { openDB } from 'idb';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  DocSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  DIFF_FORMAT_VERSION,
  Failure,
  type IStorageOpMsg,
  SessionConfigMsg,
  SessionInputMsg,
  StorageOpKind,
  StorageOpMsg,
  Transport,
  ViewEffectMsg,
} from './abi.generated';
import { type ExecutorOptions, SessionExecutor } from './executor';
import { SessionLease } from './lease';
import { decodeOutput, type Effect, Flag } from './output';
import { ownerLock, StorageAdapter } from './storage';
import { SessionTelemetry } from './telemetry';

beforeAll(() =>
  initSync({
    module: readFileSync(
      new URL(
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    ),
  })
);
afterEach(() => vi.restoreAllMocks());

function fixture(
  options: {
    doc?: string;
    owner?: string;
    durable?: boolean;
    storage?: StorageAdapter;
    afterDrain?: ExecutorOptions<DocSession>['afterDrain'];
  } = {}
) {
  const doc = options.doc ?? `corrupt-${crypto.randomUUID()}`;
  const owner = options.owner ?? crypto.randomUUID();
  const channel = new BroadcastChannel(`corrupt-${crypto.randomUUID()}`);
  const storage =
    options.storage ?? new StorageAdapter(doc, owner, 'fixture-user', locks);
  const errors: string[] = [];
  const executor = new SessionExecutor({
    doc,
    owner,
    user: 'fixture-user',
    storage,
    channel,
    locks,
    afterDrain: options.afterDrain,
    create: (now, wall) =>
      DocSession.create(
        ABI_MAJOR,
        SessionConfigMsg.encode({
          doc,
          session: owner,
          user: 'fixture-user',
          peers: [7n, 8n, 9n],
          access: Access.Edit,
          transport: Transport.None,
          durable: options.durable ?? false,
          chatter: false,
          headless: true,
          viewEngine: 1,
          viewOs: 0,
          token: '',
          traceparent: '',
          coalesce: 25,
          snapshotInterval: 0,
          observed: [{ root: 'fields', steps: [] }],
        }),
        now,
        wall
      ),
    auth: {
      token: async () => {
        throw new Error('No transport');
      },
      subscribe: () => () => {},
    },
    socketUrl: () => {
      throw new Error('No transport');
    },
    telemetry: new SessionTelemetry(NOOP_SPAN),
    view: {
      apply: (_words, _strings, effects) => {
        for (const effect of effects)
          if (effect.kind === 2) errors.push(effect.text);
      },
    },
  });
  return { executor, channel, storage, doc, owner, errors };
}

function operation(
  kind: StorageOpKind,
  scope: { doc: string; owner: string }
): IStorageOpMsg {
  return {
    kind,
    doc: scope.doc,
    owner: scope.owner,
    user: 'fixture-user',
    from: '',
    seq: 0n,
    through: 0n,
    before: 0n,
    retry: false,
    terminal: false,
    record: {
      seq: 1n,
      createdAt: 1n,
      user: 'fixture-user',
      foreign: false,
      quarantined: false,
      delivered: false,
      bytes: new Uint8Array([1]),
    },
    snapshot: new Uint8Array(),
    coversOwner: '',
    coversSeq: 0n,
    expected: [],
  };
}

// Encode the real ABI envelope, including word alignment and any original
// view payloads. The production decoder and executor consume these bytes.
function packet(effects: Effect[], original?: ReturnType<typeof decodeOutput>) {
  const view = original?.view ?? new Uint32Array();
  const strings = original?.strings ?? new Uint8Array();
  const rows: Effect[] = [
    ...effects,
    ...(original?.viewEffects ?? []).map((effect) => ({
      tag: 16,
      a: 0,
      b: 0,
      payload: ViewEffectMsg.encode(effect).slice(),
    })),
  ];
  const aligned = (length: number) => (length + 3) & ~3;
  const bytes = new Uint8Array(
    24 +
      view.byteLength +
      aligned(strings.byteLength) +
      rows.reduce((sum, row) => sum + 16 + aligned(row.payload.byteLength), 0)
  );
  const data = new DataView(bytes.buffer);
  let at = 0;
  const word = (value: number) => {
    data.setUint32(at, value, true);
    at += 4;
  };
  for (const value of [
    0x4d534553,
    ABI_MAJOR,
    DIFF_FORMAT_VERSION,
    view.length,
    strings.byteLength,
    rows.length,
  ])
    word(value);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), at);
  at += view.byteLength;
  bytes.set(strings, at);
  at += aligned(strings.byteLength);
  for (const row of rows) {
    for (const value of [row.tag, row.a, row.b, row.payload.byteLength])
      word(value);
    bytes.set(row.payload, at);
    at += aligned(row.payload.byteLength);
  }
  return bytes;
}

const kinds = [
  [StorageOpKind.Load, 'loaded'],
  [StorageOpKind.LoadOrphans, 'loaded'],
  [StorageOpKind.WalAppend, 'done'],
  [StorageOpKind.WalMarkDelivered, 'done'],
  [StorageOpKind.WalPrune, 'done'],
  [StorageOpKind.WalAdopt, 'adopted'],
  [StorageOpKind.WalDropExpired, 'done'],
  [StorageOpKind.WalQuarantine, 'done'],
  [StorageOpKind.SnapshotSave, 'done'],
  [StorageOpKind.SnapshotDelete, 'done'],
] as const;
const marker: Effect = {
  tag: 7,
  a: 0,
  b: 0,
  payload: new Uint8Array([17, 29]),
};

for (const [kind, family] of kinds) {
  for (const corruption of [
    'empty',
    'truncated',
    'trailing',
    'unknown-inner',
    'mismatch',
  ] as const) {
    test(`encoded ${StorageOpKind[kind]} ${corruption} completes Corrupt and keeps later effects`, async () => {
      const f = fixture();
      const loaded = vi
        .spyOn(f.executor.session, 'storageLoaded')
        .mockReturnValue(0);
      const adopted = vi
        .spyOn(f.executor.session, 'storageAdopted')
        .mockReturnValue(0);
      const done = vi
        .spyOn(f.executor.session, 'storageDone')
        .mockReturnValue(0);
      const execute = vi.spyOn(f.storage, 'execute');
      const database = vi.spyOn(indexedDB, 'open');
      const requests = vi.spyOn(locks, 'request');
      const messages = vi.spyOn(f.channel, 'postMessage');
      const valid = StorageOpMsg.encode(operation(kind, f));
      let body = valid.slice();
      if (corruption === 'empty') body = new Uint8Array();
      if (corruption === 'truncated') body = body.slice(0, -1);
      if (corruption === 'trailing') body = new Uint8Array([...body, 0]);
      if (corruption === 'unknown-inner') body[0] = 255;
      if (corruption === 'mismatch')
        body[0] =
          kind === StorageOpKind.Load
            ? StorageOpKind.LoadOrphans
            : StorageOpKind.Load;
      vi.spyOn(f.executor.session, 'takeOutput').mockReturnValueOnce(
        packet([{ tag: 6, a: 73, b: kind, payload: body }, marker])
      );
      try {
        expect(() => f.executor.run(() => Flag.Io)).not.toThrow();
        await f.executor.idle();
        expect(messages.mock.calls).toEqual([
          [{ type: 'update', data: marker.payload }],
        ]);
        expect(execute).not.toHaveBeenCalled();
        expect(database).not.toHaveBeenCalled();
        expect(requests).not.toHaveBeenCalled();
        if (family === 'loaded') {
          expect(loaded).toHaveBeenCalledOnce();
          expect(loaded.mock.calls[0].slice(0, 3)).toEqual([
            73,
            undefined,
            Failure.Corrupt,
          ]);
          expect(adopted).not.toHaveBeenCalled();
          expect(done).not.toHaveBeenCalled();
        } else if (family === 'adopted') {
          expect(adopted).toHaveBeenCalledOnce();
          expect(adopted.mock.calls[0].slice(0, 3)).toEqual([
            73,
            -1,
            Failure.Corrupt,
          ]);
          expect(loaded).not.toHaveBeenCalled();
          expect(done).not.toHaveBeenCalled();
        } else {
          expect(done).toHaveBeenCalledOnce();
          expect(done.mock.calls[0].slice(0, 3)).toEqual([
            73,
            false,
            Failure.Corrupt,
          ]);
          expect(loaded).not.toHaveBeenCalled();
          expect(adopted).not.toHaveBeenCalled();
        }
      } finally {
        await f.executor.close();
      }
    });
  }
}

test('known corrupt completion does not wait for the owner lease grant', async () => {
  const doc = `held-corrupt-${crypto.randomUUID()}`,
    owner = crypto.randomUUID();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const held = locks.request(ownerLock(doc, owner), async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const f = fixture({ doc, owner });
  const complete = Promise.withResolvers<void>();
  const loaded = vi
    .spyOn(f.executor.session, 'storageLoaded')
    .mockImplementation(() => {
      complete.resolve();
      return 0;
    });
  const execute = vi.spyOn(f.storage, 'execute');
  vi.spyOn(f.executor.session, 'takeOutput').mockReturnValueOnce(
    packet([
      { tag: 6, a: 81, b: StorageOpKind.Load, payload: new Uint8Array() },
      marker,
    ])
  );
  try {
    f.executor.run(() => Flag.Io);
    await complete.promise;
    expect(loaded.mock.calls[0].slice(0, 3)).toEqual([
      81,
      undefined,
      Failure.Corrupt,
    ]);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (await locks.query()).pending.some(
        (lock) => lock.name === ownerLock(doc, owner)
      )
    ).toBe(true);
  } finally {
    release.resolve();
    await held;
    await f.executor.close();
  }
});

test('a malformed real native Load completes its pending id and can Stop normally', async () => {
  const f = fixture({ durable: true });
  const take = f.executor.session.takeOutput.bind(f.executor.session);
  const loaded = vi.spyOn(f.executor.session, 'storageLoaded');
  const execute = vi.spyOn(f.storage, 'execute');
  let request: number | undefined;
  vi.spyOn(f.executor.session, 'takeOutput').mockImplementationOnce(() => {
    const out = decodeOutput(take());
    const load = out.effects.find(
      (effect) => effect.tag === 6 && effect.b === StorageOpKind.Load
    );
    expect(load).toBeDefined();
    if (!load) throw new Error('Native Start did not issue its Load');
    request = load.a;
    return packet(
      out.effects.map((effect) =>
        effect === load ? { ...effect, payload: new Uint8Array() } : effect
      ),
      out
    );
  });
  try {
    expect(() => f.executor.start()).not.toThrow();
    await f.executor.idle();
    expect(request).toBeDefined();
    expect(loaded).toHaveBeenCalledOnce();
    expect(loaded.mock.calls[0].slice(0, 3)).toEqual([
      request,
      undefined,
      Failure.Corrupt,
    ]);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await f.executor.close();
  }
});

test('unknown outer kind reports an error after later effects and closes pending replies once', async () => {
  const f = fixture();
  const messages = vi.spyOn(f.channel, 'postMessage');
  const loaded = vi.spyOn(f.executor.session, 'storageLoaded');
  const adopted = vi.spyOn(f.executor.session, 'storageAdopted');
  const done = vi.spyOn(f.executor.session, 'storageDone');
  const execute = vi.spyOn(f.storage, 'execute');
  const inputKinds: number[] = [];
  const nativeInput = f.executor.session.input.bind(f.executor.session);
  vi.spyOn(f.executor.session, 'input').mockImplementation(
    (bytes, now, wall) => {
      inputKinds.push(SessionInputMsg.decode(bytes).kind);
      // Keep only the first request pending; preserve the real native Stop.
      if (inputKinds.length === 1) return 0;
      return nativeInput(bytes, now, wall);
    }
  );
  // Keep a JS request outstanding; the real native Stop below is not mocked.
  const reply = f.executor.flush().then(
    () => 'resolved',
    () => 'rejected'
  );
  vi.spyOn(f.executor.session, 'takeOutput').mockReturnValueOnce(
    packet([
      {
        tag: 6,
        a: 83,
        b: 255,
        payload: StorageOpMsg.encode(operation(StorageOpKind.Load, f)),
      },
      marker,
    ])
  );
  const freed = vi.spyOn(f.executor.session, 'free');
  try {
    expect(() => f.executor.run(() => Flag.Io)).not.toThrow();
    expect(messages.mock.calls[0]).toEqual([
      { type: 'update', data: marker.payload },
    ]);
    await f.executor.idle();
    expect(await reply).toBe('rejected');
    expect(f.errors).toContain('Unknown storage operation');
    expect(inputKinds.filter((kind) => kind === 5)).toHaveLength(1);
    expect(freed).toHaveBeenCalledOnce();
    expect(loaded).not.toHaveBeenCalled();
    expect(adopted).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await f.executor.close();
  }
});

test('corrupt completion stays between held and later WAL writes before lease release', async () => {
  const doc = `wal-corrupt-${crypto.randomUUID()}`,
    owner = crypto.randomUUID();
  const storage = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const append = operation(StorageOpKind.WalAppend, { doc, owner });
  await storage.execute(append);
  await storage.execute({
    ...operation(StorageOpKind.SnapshotSave, { doc, owner }),
    snapshot: new Uint8Array([9]),
  });
  const f = fixture({ doc, owner, storage });
  const first = {
    ...append,
    record: { ...append.record, seq: 2n, bytes: new Uint8Array([2]) },
  };
  const later = {
    ...append,
    record: { ...append.record, seq: 3n, bytes: new Uint8Array([3]) },
  };
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const apply = storage.execute.bind(storage);
  const execute = vi
    .spyOn(storage, 'execute')
    .mockImplementation(async (op) => {
      if (op.record.seq === 2n) {
        started.resolve();
        await release.promise;
      }
      return apply(op);
    });
  const completions: number[][] = [];
  vi.spyOn(f.executor.session, 'storageDone').mockImplementation(
    (id, ok, failure) => {
      completions.push([id, Number(ok), failure]);
      return 0;
    }
  );
  const released = vi.spyOn(SessionLease.prototype, 'release');
  vi.spyOn(f.executor.session, 'takeOutput').mockReturnValueOnce(
    packet([
      {
        tag: 6,
        a: 91,
        b: StorageOpKind.WalAppend,
        payload: StorageOpMsg.encode(first).slice(),
      },
      {
        tag: 6,
        a: 92,
        b: StorageOpKind.SnapshotSave,
        payload: new Uint8Array(),
      },
      {
        tag: 6,
        a: 93,
        b: StorageOpKind.WalAppend,
        payload: StorageOpMsg.encode(later).slice(),
      },
      marker,
    ])
  );
  try {
    f.executor.run(() => Flag.Io);
    await started.promise;
    const closing = f.executor.close();
    expect(released).not.toHaveBeenCalled();
    expect(completions).toEqual([]);
    release.resolve();
    await closing;
    expect(execute).toHaveBeenCalledTimes(2);
    expect(completions).toEqual([
      [91, 1, Failure.None],
      [92, 0, Failure.Corrupt],
      [93, 1, Failure.None],
    ]);
    expect(released).toHaveBeenCalledOnce();
    const wal = await openDB('macro-document-wal', 1);
    expect(
      (await wal.getAllFromIndex('updates', 'scopeId', doc)).map(
        (row) => row.seq
      )
    ).toEqual([1n, 2n, 3n]);
    wal.close();
    const snapshots = await openDB('macro-document-snapshots', 1);
    expect(await snapshots.get('snapshots', doc)).toEqual({
      scopeId: doc,
      snapshot: new Uint8Array([9]),
    });
    snapshots.close();
  } finally {
    release.resolve();
    await f.executor.close();
  }
});

test('a native completion trap remains a native drain failure, not a second corrupt completion', async () => {
  const cause = new WebAssembly.RuntimeError('fixture completion trap');
  const failures: unknown[] = [];
  const f = fixture({
    afterDrain: (failure) => {
      if (failure) failures.push(failure.error);
    },
  });
  const loaded = vi
    .spyOn(f.executor.session, 'storageLoaded')
    .mockImplementation(() => {
      throw cause;
    });
  vi.spyOn(f.executor.session, 'takeOutput').mockReturnValueOnce(
    packet([
      { tag: 6, a: 97, b: StorageOpKind.Load, payload: new Uint8Array() },
      marker,
    ])
  );
  try {
    f.executor.run(() => Flag.Io);
    await f.executor.idle();
    expect(loaded).toHaveBeenCalledOnce();
    expect(loaded.mock.calls[0].slice(0, 3)).toEqual([
      97,
      undefined,
      Failure.Corrupt,
    ]);
    expect(failures).toContain(cause);
    expect(f.errors).toContain('fixture completion trap');
  } finally {
    await f.executor.close();
  }
});

test('host afterDrain failure is not swallowed by decode containment', async () => {
  const cause = { failure: 'fixture host drain' };
  let fail = true;
  const f = fixture({
    afterDrain: () => {
      if (fail) {
        fail = false;
        throw cause;
      }
    },
  });
  const loaded = vi
    .spyOn(f.executor.session, 'storageLoaded')
    .mockReturnValue(0);
  const messages = vi.spyOn(f.channel, 'postMessage');
  vi.spyOn(f.executor.session, 'takeOutput').mockReturnValueOnce(
    packet([
      { tag: 6, a: 99, b: StorageOpKind.Load, payload: new Uint8Array() },
      marker,
    ])
  );
  try {
    let caught: { error: unknown } | undefined;
    try {
      f.executor.run(() => Flag.Io);
    } catch (error) {
      caught = { error };
    }
    expect(caught?.error).toBe(cause);
    await f.executor.idle();
    expect(loaded).toHaveBeenCalledOnce();
    expect(messages.mock.calls).toEqual([
      [{ type: 'update', data: marker.payload }],
    ]);
  } finally {
    await f.executor.close();
  }
});
