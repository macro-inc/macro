import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { NOOP_SPAN } from '@macro-inc/observability';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import {
  DocSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { FromPeer, FromRemote } from '../sync-service/generated/schema';
import { intoFrames } from '../websocket/platform/framing/frames';
import { ABI_MAJOR } from './abi.generated';
import { SessionExecutor } from './executor';
import { SessionTelemetry } from './telemetry';

interface Call {
  name: string;
  args: unknown[];
}
interface Action {
  kind: 'input' | 'frame' | 'open' | 'advance' | 'close';
  at: number;
  bytes?: number[];
}
interface Trace {
  seed: number;
  config: number[];
  actions: Action[];
  calls: Call[];
}
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
afterEach(() => {
  vi.useRealTimers();
});

class FakeSocket extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  binaryType: BinaryType = 'arraybuffer';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  readyState = 0;
  url = 'ws://fixture.invalid';
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly pending: Uint8Array[] = [];
  constructor(private readonly since: Uint8Array[]) {
    super();
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  frame(bytes: Uint8Array) {
    this.onmessage?.(
      new MessageEvent('message', { data: bytes.slice().buffer })
    );
  }
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (typeof data === 'string') {
      if (data === 'ping')
        this.onmessage?.(new MessageEvent('message', { data: 'pong' }));
      return;
    }
    if (!ArrayBuffer.isView(data))
      throw new Error('Fixture expected a binary view');
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const message = FromPeer.decode(bytes.subarray(1));
    if (message.isPeerRequestSince()) {
      const next = this.since.shift();
      if (!next) throw new Error('Unexpected since request');
      this.pending.push(next);
    }
    if (message.isPeerUpdate())
      for (const frame of intoFrames(
        FromRemote.encode(
          FromRemote.fromRemoteUpdateAck({ id: message.value.id })
        )
      ))
        this.pending.push(frame);
  }
  close(code = 1000) {
    this.readyState = 3;
    const event = Object.assign(new Event('close'), {
      code,
      reason: '',
      wasClean: true,
    });
    this.onclose?.(event);
  }
}
function isTrace(value: unknown): value is Trace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'seed' in value &&
    'actions' in value &&
    'calls' in value &&
    'config' in value
  );
}
const directory = new URL('../../tests/executor-traces/', import.meta.url);
test('an early browser wake keeps an unchanged native deadline armed', async () => {
  const { SessionConfigMsg, SessionInputMsg, Transport, Access } = await import(
    './abi.generated'
  );
  const { emptyInput } = await import('./input');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let mono = 0;
  const config = SessionConfigMsg.encode({
    doc: 'early-wake-fixture',
    session: '00000000-0000-0000-0000-000000000001',
    user: 'fixture-user',
    peers: [7n, 8n, 9n],
    access: Access.Edit,
    transport: Transport.None,
    durable: false,
    chatter: false,
    headless: true,
    viewEngine: 0,
    viewOs: 0,
    token: '',
    traceparent: '',
    coalesce: 25,
    snapshotInterval: 10,
    observed: [],
  });
  const executor = new SessionExecutor({
    doc: 'early-wake-fixture',
    owner: '00000000-0000-0000-0000-000000000001',
    user: 'fixture-user',
    create: (now, wall) => DocSession.create(ABI_MAJOR, config, now, wall),
    clock: { mono: () => mono, wall: () => 1_000_000 + mono },
    auth: {
      token: async () => ({ token: '', access: Access.Edit }),
      subscribe: () => () => {},
    },
    socketUrl: () => {
      throw new Error('Offline fixture cannot connect');
    },
    view: { apply() {} },
    telemetry: new SessionTelemetry(NOOP_SPAN),
  });
  executor.start();
  executor.run(() =>
    executor.session.input(
      SessionInputMsg.encode(emptyInput(1)),
      executor.now(),
      1_000_000
    )
  );
  expect(executor.session.wakeAt()).toBe(10);
  mono = 9.9;
  await vi.advanceTimersByTimeAsync(10);
  expect(executor.session.wakeAt()).toBe(10);
  mono = 10.1;
  await vi.advanceTimersByTimeAsync(1);
  expect(executor.session.wakeAt()).toBe(20);
  await executor.close();
});
for (const file of readdirSync(directory).filter((f) => f.endsWith('.json'))) {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(file, directory), 'utf8')
  );
  if (!isTrace(parsed)) throw new Error('Invalid native trace');
  const trace = parsed;
  test(`native executor trace ${trace.seed}: exact I/O completion sequence through real WASM and IDB`, async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(1_000_000);
    const calls: Call[] = [];
    const since = trace.calls
      .filter((c) => c.name === 'socketFrame')
      .map((c) => new Uint8Array(Array.isArray(c.args[1]) ? c.args[1] : []))
      .filter((frame) =>
        FromRemote.decode(frame.subarray(1)).isRemoteUpdateSince()
      );
    let socket: FakeSocket | undefined;
    const config = new Uint8Array(trace.config);
    const { SessionConfigMsg } = await import('./abi.generated');
    const decoded = SessionConfigMsg.decode(config);
    const executor = new SessionExecutor({
      doc: decoded.doc,
      owner: decoded.session,
      user: decoded.user,
      create: (now, wall) => {
        const native = DocSession.create(ABI_MAJOR, config, now, wall);
        return new Proxy(native, {
          get(target, key) {
            const value: unknown = Reflect.get(target, key);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
              if (
                !['takeOutput', 'wakeAt', 'free', 'read'].includes(String(key))
              )
                calls.push({
                  name: String(key),
                  args: args.map((v) => (v instanceof Uint8Array ? [...v] : v)),
                });
              return Reflect.apply(value, target, args);
            };
          },
        });
      },
      auth: {
        token: async () => ({ token: 'fixture-token', access: 2 }),
        subscribe: () => () => {},
      },
      view: {
        apply: (_words, _strings, effects) => {
          for (const effect of effects)
            if (effect.kind === 2) throw new Error(effect.text);
        },
      },
      socketUrl: () => 'ws://fixture.invalid',
      telemetry: new SessionTelemetry(NOOP_SPAN),
      sockets: () => {
        socket = new FakeSocket(since);
        return socket;
      },
      clock: { mono: () => Date.now() - 1_000_000, wall: () => Date.now() },
    });
    const settle = async () => {
      for (;;) {
        await executor.idle();
        if (!socket?.pending.length) return;
        const frame = socket.pending.shift();
        if (frame) socket.frame(frame);
      }
    };
    let at = 0;
    const advance = async (target: number) => {
      for (;;) {
        const wake = executor.session.wakeAt();
        if (wake < 0 || wake > target) break;
        await vi.advanceTimersByTimeAsync(Math.max(0, wake - at));
        at = wake;
        await settle();
      }
      await vi.advanceTimersByTimeAsync(target - at);
      at = target;
      await settle();
    };
    for (const action of trace.actions) {
      await advance(action.at);
      if (action.kind === 'input')
        executor.run(() =>
          executor.session.input(
            new Uint8Array(action.bytes ?? []),
            executor.now(),
            Date.now()
          )
        );
      if (action.kind === 'open') socket?.open();
      if (action.kind === 'frame')
        socket?.frame(new Uint8Array(action.bytes ?? []));
      if (action.kind === 'close') await executor.close();
      await settle();
    }
    expect(calls).toEqual(trace.calls);
  });
}

test('failed native construction allocates no owner lock, channel or authorization listener', async () => {
  const request = vi.fn();
  const subscribe = vi.fn();
  const channel = new BroadcastChannel('failed-create-fixture');
  try {
    expect(
      () =>
        new SessionExecutor({
          doc: 'failed-create',
          owner: 'owner',
          user: 'fixture-user',
          create: () => {
            throw new Error('invalid native configuration');
          },
          auth: {
            token: async () => ({ token: 'fixture-token', access: 2 }),
            subscribe,
          },
          view: { apply: () => {} },
          socketUrl: () => '',
          telemetry: new SessionTelemetry(NOOP_SPAN),
          locks: { ...navigator.locks, request },
          channel,
        })
    ).toThrow('invalid native configuration');
    expect(request).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  } finally {
    channel.close();
  }
});

test('closing before start releases the real owner lock before Closing and is repeatable', async () => {
  const { SessionConfigMsg, Transport } = await import('./abi.generated');
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('01.json', directory), 'utf8')
  );
  if (!isTrace(parsed)) throw new Error('Invalid trace');
  const config = {
    ...SessionConfigMsg.decode(new Uint8Array(parsed.config)),
    doc: 'close-before-start',
    transport: Transport.None,
    durable: false,
    chatter: false,
  };
  const channel = new BroadcastChannel('close-before-start');
  const locksOnClosing: Promise<LockManagerSnapshot>[] = [];
  const post = vi.spyOn(channel, 'postMessage').mockImplementation(() => {
    locksOnClosing.push(navigator.locks.query());
  });
  const executor = new SessionExecutor({
    doc: config.doc,
    owner: config.session,
    user: config.user,
    create: (now, wall) =>
      DocSession.create(ABI_MAJOR, SessionConfigMsg.encode(config), now, wall),
    auth: {
      token: async () => ({ token: 'fixture-token', access: 2 }),
      subscribe: () => () => {},
    },
    view: { apply: () => {} },
    socketUrl: () => '',
    telemetry: new SessionTelemetry(NOOP_SPAN),
    channel,
  });
  const first = executor.close();
  expect(executor.close()).toBe(first);
  await first;
  expect(post).toHaveBeenCalledOnce();
  for (const snapshot of await Promise.all(locksOnClosing))
    expect(
      snapshot.held?.some(
        (lock) => lock.name === `macro-wal:${config.doc}:${config.session}`
      )
    ).toBe(false);
  const locks = await navigator.locks.query();
  expect(
    locks.held?.some(
      (lock) => lock.name === `macro-wal:${config.doc}:${config.session}`
    )
  ).toBe(false);
});

test('router disposal rejects late socket and token callbacks without touching freed WASM', async () => {
  const { SyncRouter } = await import(
    '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js'
  );
  const { SessionRouter } = await import('./router');
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('01.json', directory), 'utf8')
  );
  if (!isTrace(parsed)) throw new Error('Invalid trace');
  let complete!: (result: { token: string; access: number }) => void;
  const token = new Promise<{ token: string; access: number }>((resolve) => {
    complete = resolve;
  });
  const socket = new FakeSocket([]);
  vi.spyOn(socket, 'send').mockImplementation(() => {});
  let freed = false;
  const lateCalls: string[] = [];
  const router = new SessionRouter(
    (now, wall) => {
      const native = SyncRouter.create(
        ABI_MAJOR,
        new Uint8Array(parsed.config),
        now,
        wall
      );
      return new Proxy(native, {
        get(target, key) {
          const value: unknown = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            if (freed) lateCalls.push(String(key));
            if (key === 'free') freed = true;
            return Reflect.apply(value, target, args);
          };
        },
      });
    },
    { token: () => token, subscribe: () => () => {} },
    () => '',
    new SessionTelemetry(NOOP_SPAN),
    () => socket
  );
  const detach = router.attach('router-dispose', () => {});
  socket.open();
  detach();
  router.free();
  router.free();
  socket.onmessage?.(new MessageEvent('message', { data: 'pong' }));
  socket.onerror?.(new Event('error'));
  complete({ token: 'fixture-token', access: 2 });
  await token;
  await Promise.resolve();
  expect(lateCalls).toEqual([]);
});
