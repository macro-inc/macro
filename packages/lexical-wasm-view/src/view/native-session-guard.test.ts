/** Node/Bun fixture over a real generated ordinary module, not browser acceptance. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { expect, test, vi } from 'vitest';
import {
  installNativeSessionReceiverGuard,
  type NativeSessionConstructor,
} from './native-session-guard';

function isNativeSessionConstructor(
  value: unknown
): value is NativeSessionConstructor {
  return typeof value === 'function' && typeof value.prototype === 'object';
}
function invoke(
  target: object,
  key: PropertyKey,
  args: unknown[] = []
): unknown {
  const method: unknown = Reflect.get(target, key);
  if (typeof method !== 'function')
    throw new Error(`Missing native method ${String(key)}`);
  return Reflect.apply(method, target, args);
}
let moduleId = 0;
async function fixture() {
  const js = process.env.NATIVE_SESSION_GUARD_JS;
  const wasm = process.env.NATIVE_SESSION_GUARD_WASM;
  if (!js || !wasm)
    throw new Error('Real ordinary guard JS/WASM fixture paths are required');
  const url = pathToFileURL(js);
  url.searchParams.set('guard-fixture', String(++moduleId));
  const module: unknown = await import(/* @vite-ignore */ url.href);
  if (typeof module !== 'object' || module === null)
    throw new Error('Native module missing');
  invoke(module, 'initSync', [{ module: readFileSync(wasm) }]);
  const ctor: unknown = Reflect.get(module, 'EditorSession');
  if (!isNativeSessionConstructor(ctor))
    throw new Error('Generated EditorSession is required');
  const actualConstructor = ctor;
  const config = SessionConfigMsg.encode({
    doc: 'native-guard-fixture',
    session: '00000000-0000-0000-0000-000000000001',
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
  }).slice();
  const createArgs = [ABI_MAJOR, config, 0, 0];
  function create() {
    const session = invoke(actualConstructor, 'create', createArgs);
    if (typeof session !== 'object' || session === null)
      throw new Error('Native session missing');
    for (const kind of [0, 1]) {
      invoke(session, 'input', [
        SessionInputMsg.encode(emptyInput(kind)),
        kind,
        kind,
      ]);
      invoke(session, 'takeOutput');
    }
    return session;
  }
  return { module, ctor: actualConstructor, create, createArgs };
}

test('real callbacks fence same/other-owner receivers and static admission before bindgen', async () => {
  const { module, ctor, create, createArgs } = await fixture();
  let active = false;
  let returns = 0;
  let accesses = 0;
  // Descriptor mechanics on the real class; this is not a generated accessor.
  Object.defineProperty(ctor.prototype, 'guardAccess', {
    configurable: true,
    get(this: object) {
      accesses++;
      return invoke(this, 'effectiveAccess');
    },
    set() {
      accesses++;
    },
  });
  const hooks = {
    active: () => active,
    afterReturn: () => {
      returns++;
    },
  };
  const oldFree = Object.getOwnPropertyDescriptor(ctor.prototype, 'free');
  const controller = installNativeSessionReceiverGuard(ctor, hooks);
  expect(installNativeSessionReceiverGuard(ctor, { ...hooks })).toBe(
    controller
  );
  expect(() =>
    installNativeSessionReceiverGuard(ctor, { active: () => false })
  ).toThrow('different hooks');
  expect(Object.getOwnPropertyDescriptor(ctor.prototype, 'free')).toMatchObject(
    {
      configurable: oldFree?.configurable,
      enumerable: oldFree?.enumerable,
      writable: oldFree?.writable,
    }
  );
  if (Symbol.dispose)
    expect(Reflect.get(ctor.prototype, Symbol.dispose)).toBe(
      Reflect.get(ctor.prototype, 'free')
    );
  const first = create();
  const other = create();
  const pointer = Reflect.get(first, '__wbg_ptr');
  const unexpected: { error: unknown }[] = [];
  let callbackCalls = 0;
  invoke(module, 'installViewCommandHost', [
    (_owner: bigint, _callback: bigint, _invocation: bigint, scope: bigint) => {
      active = true;
      try {
        const before = returns;
        for (const session of [first, other]) {
          expect(() => invoke(session, 'effectiveAccess')).toThrow(
            'scoped callback'
          );
          expect(() => invoke(session, 'free')).toThrow('scoped callback');
          expect(() => invoke(session, 'viewCommandEnter', [2, 2])).toThrow(
            'scoped callback'
          );
          expect(() => Reflect.get(session, 'guardAccess')).toThrow(
            'scoped callback'
          );
          expect(() => Reflect.set(session, 'guardAccess', 1)).toThrow(
            'scoped callback'
          );
          if (Symbol.dispose)
            expect(() => invoke(session, Symbol.dispose)).toThrow(
              'scoped callback'
            );
        }
        for (const key of Reflect.ownKeys(ctor))
          if (typeof key === 'string' && key.startsWith('create'))
            expect(() => invoke(ctor, key, createArgs)).toThrow(
              'scoped callback'
            );
        expect(accesses).toBe(0);
        expect(Reflect.get(first, '__wbg_ptr')).toBe(pointer);
        expect(
          invoke(module, 'viewCommandScopeSelection', [scope])
        ).toBeInstanceOf(Uint8Array);
        expect(invoke(module, 'viewCommandScopeOwnJSON', [scope, 0])).toContain(
          'root'
        );
        expect(returns).toBe(before);
        callbackCalls++;
        return true;
      } catch (error) {
        unexpected.push({ error });
        throw error;
      } finally {
        active = false;
      }
    },
    () => {
      throw new Error('No unexpected callback failure lookup');
    },
  ]);
  try {
    invoke(first, 'registerViewEnter', [1n, 4]);
    const before = returns;
    const flags = invoke(first, 'viewCommandEnter', [2, 2]);
    if (unexpected.length) throw unexpected[0].error;
    expect(callbackCalls).toBe(1);
    expect(typeof flags).toBe('number');
    expect(returns).toBe(before + 1);
    invoke(first, 'takeOutput');
    expect(invoke(first, 'effectiveAccess')).toBe(Access.Edit);
    const beforeAccess = returns;
    expect(Reflect.get(first, 'guardAccess')).toBe(Access.Edit);
    expect(returns).toBe(beforeAccess + 1);
    expect(controller.takeCleanupFailure()).toBeUndefined();
  } finally {
    invoke(first, 'free');
    invoke(other, 'free');
  }
});

test('cleanup cannot replace real native results or opaque primary argument failures', async () => {
  const { ctor, create } = await fixture();
  const secondary = { cleanup: true };
  let failCleanup = false;
  const guard = installNativeSessionReceiverGuard(ctor, {
    active: () => false,
    afterReturn() {
      if (failCleanup) {
        failCleanup = false;
        throw secondary;
      }
    },
  });
  const session = create();
  try {
    failCleanup = true;
    expect(invoke(session, 'tick', [2, 2])).toEqual(expect.any(Number));
    invoke(session, 'takeOutput');
    expect(guard.takeCleanupFailure()?.error).toBe(secondary);
    for (const original of [undefined, null, { primary: true }]) {
      const badNow = {
        [Symbol.toPrimitive]() {
          throw original;
        },
      };
      let thrown = false;
      failCleanup = true;
      try {
        invoke(session, 'viewCommandEnter', [badNow, 3]);
      } catch (error) {
        thrown = true;
        expect(error).toBe(original);
      }
      expect(thrown).toBe(true);
      invoke(session, 'takeOutput');
      expect(guard.takeCleanupFailure()?.error).toBe(secondary);
    }
    expect(guard.takeCleanupFailure()).toBeUndefined();
  } finally {
    invoke(session, 'free');
  }
});

test('descriptor preflight refuses an immutable real native method without changes', async () => {
  const { ctor } = await fixture();
  Object.defineProperty(ctor, 'createMacro', {
    writable: false,
    configurable: false,
  });
  const before = Object.getOwnPropertyDescriptors(ctor.prototype);
  expect(() =>
    installNativeSessionReceiverGuard(ctor, { active: () => false })
  ).toThrow('cannot be guarded');
  expect(Object.getOwnPropertyDescriptors(ctor.prototype)).toEqual(before);
});

test('failed installation restores real native descriptors and preserves undefined', async () => {
  const { ctor, create } = await fixture();
  const before = Object.getOwnPropertyDescriptors(ctor.prototype);
  const staticBefore = Object.getOwnPropertyDescriptors(ctor);
  const define = Object.defineProperty;
  let fail = true;
  const spy = vi
    .spyOn(Object, 'defineProperty')
    .mockImplementation((target, key, descriptor) => {
      if (target === ctor && key === 'createMacro' && fail) {
        fail = false;
        throw undefined;
      }
      return define(target, key, descriptor);
    });
  const hooks = { active: () => false };
  let thrown = false;
  try {
    installNativeSessionReceiverGuard(ctor, hooks);
  } catch (error) {
    thrown = true;
    expect(error).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
  expect(thrown).toBe(true);
  expect(Object.getOwnPropertyDescriptors(ctor.prototype)).toEqual(before);
  expect(Object.getOwnPropertyDescriptors(ctor)).toEqual(staticBefore);
  installNativeSessionReceiverGuard(ctor, hooks);
  invoke(create(), 'free');
});
