/** Node/Bun fixture over a real generated ordinary module, not browser acceptance. */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  assertNativeSessionReceiverAdmission,
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
// The production document-session artifact the package's other native tests
// import; NATIVE_SESSION_GUARD_JS/WASM select another build (a preview profile).
const ARTIFACT = new URL(
  '../../../../apps/web/src/lib/core/document-session/wasm/',
  import.meta.url
);
function fixturePaths() {
  const js = process.env.NATIVE_SESSION_GUARD_JS;
  const wasm = process.env.NATIVE_SESSION_GUARD_WASM;
  if (!js && !wasm)
    return {
      js: fileURLToPath(new URL('document_session_wasm.js', ARTIFACT)),
      wasm: fileURLToPath(new URL('document_session_wasm_bg.wasm', ARTIFACT)),
    };
  if (!js || !wasm)
    throw new Error(
      'Set both NATIVE_SESSION_GUARD_JS and NATIVE_SESSION_GUARD_WASM, or neither'
    );
  return { js, wasm };
}
async function fixture() {
  const { js, wasm } = fixturePaths();
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
  expect(controller.completedEntryToken()).toBe(0n);
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
        const completed = controller.completedEntryToken();
        expect(() => assertNativeSessionReceiverAdmission(first)).toThrow(
          'scoped callback'
        );
        for (const session of [first, other]) {
          expect(() => invoke(session, 'effectiveAccess')).toThrow(
            'scoped callback'
          );
          expect(() => invoke(session, 'free')).toThrow('scoped callback');
          expect(() => invoke(session, 'clipboardDom', [0, '{}'])).toThrow(
            'scoped callback'
          );
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
        expect(controller.completedEntryToken()).toBe(completed);
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
    const completed = controller.completedEntryToken();
    const flags = invoke(first, 'viewCommandEnter', [2, 2]);
    if (unexpected.length) throw unexpected[0].error;
    expect(callbackCalls).toBe(1);
    expect(typeof flags).toBe('number');
    expect(returns).toBe(before + 1);
    expect(controller.completedEntryToken()).toBe(completed + 1n);
    invoke(first, 'takeOutput');
    expect(invoke(first, 'effectiveAccess')).toBe(Access.Edit);
    const beforeAccess = returns;
    const beforeNested = controller.completedEntryToken();
    expect(Reflect.get(first, 'guardAccess')).toBe(Access.Edit);
    expect(returns).toBe(beforeAccess + 1);
    expect(controller.completedEntryToken()).toBe(beforeNested + 1n);
    expect(controller.takeCleanupFailure()).toBeUndefined();
  } finally {
    const beforeFree = controller.completedEntryToken();
    invoke(first, 'free');
    expect(controller.completedEntryToken()).toBe(beforeFree + 1n);
    invoke(other, 'free');
    expect(controller.completedEntryToken()).toBe(beforeFree + 2n);
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
      const before = guard.completedEntryToken();
      failCleanup = true;
      try {
        invoke(session, 'viewCommandEnter', [badNow, 3]);
      } catch (error) {
        thrown = true;
        expect(error).toBe(original);
      }
      expect(thrown).toBe(true);
      expect(guard.completedEntryToken()).toBe(before + 1n);
      invoke(session, 'takeOutput');
      expect(guard.takeCleanupFailure()?.error).toBe(secondary);
    }
    expect(guard.takeCleanupFailure()).toBeUndefined();
  } finally {
    invoke(session, 'free');
  }
});

test('completed entry token advances after cleanup and excludes cleaning rejections', async () => {
  const { ctor, createArgs } = await fixture();
  const observed: bigint[] = [];
  const rejected: boolean[] = [];
  const admissionRejected: boolean[] = [];
  let current: object | undefined;
  const hooks = {
    active: () => false,
    afterReturn() {
      observed.push(guard.completedEntryToken());
      try {
        invoke(ctor, 'create', createArgs);
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
      if (current) {
        try {
          assertNativeSessionReceiverAdmission(current);
          admissionRejected.push(false);
        } catch {
          admissionRejected.push(true);
        }
      }
      expect(guard.completedEntryToken()).toBe(observed.at(-1));
    },
  };
  const guard = installNativeSessionReceiverGuard(ctor, hooks);
  expect(guard.completedEntryToken()).toBe(0n);
  const session = invoke(ctor, 'create', createArgs);
  if (typeof session !== 'object' || session === null)
    throw new Error('Missing actual native session');
  current = session;
  try {
    expect(guard.completedEntryToken()).toBe(1n);
    expect(observed).toEqual([0n]);
    expect(rejected).toEqual([true]);
    assertNativeSessionReceiverAdmission(session);
    expect(invoke(session, 'effectiveAccess')).toBe(Access.Edit);
    expect(guard.completedEntryToken()).toBe(2n);
    expect(admissionRejected).toEqual([true]);
    expect(installNativeSessionReceiverGuard(ctor, hooks)).toBe(guard);
    expect(guard.completedEntryToken()).toBe(2n);
  } finally {
    invoke(session, 'free');
  }
  expect(observed).toEqual([0n, 1n, 2n]);
  expect(rejected).toEqual([true, true, true]);
  expect(admissionRejected).toEqual([true, true]);
  expect(guard.completedEntryToken()).toBe(3n);
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

// Descriptor contract only: the pinned ordinary artifact has no validation export.
test('existing static validation shares admission, cleanup and completion observation', () => {
  let calls = 0;
  const cause = { reason: 'validation failure' };
  class DescriptorFixture {
    static validateHostedCallbacks(fail: boolean): void {
      calls++;
      if (fail) throw cause;
    }
  }
  let active = false;
  const observed: bigint[] = [];
  const hooks = {
    active: () => active,
    afterReturn() {
      observed.push(guard.completedEntryToken());
      expect(() => DescriptorFixture.validateHostedCallbacks(false)).toThrow(
        'scoped callback or cleanup'
      );
    },
  };
  const guard = installNativeSessionReceiverGuard(DescriptorFixture, hooks);
  active = true;
  expect(() => DescriptorFixture.validateHostedCallbacks(false)).toThrow(
    'scoped callback or cleanup'
  );
  expect(guard.completedEntryToken()).toBe(0n);
  expect(calls).toBe(0);
  active = false;
  DescriptorFixture.validateHostedCallbacks(false);
  expect(guard.completedEntryToken()).toBe(1n);
  expect(() => DescriptorFixture.validateHostedCallbacks(true)).toThrow(cause);
  expect(guard.completedEntryToken()).toBe(2n);
  expect(observed).toEqual([0n, 1n]);
  expect(calls).toBe(2);
  expect(guard.takeCleanupFailure()).toBeUndefined();
});

// UNAPPLIED/UNRUN. Guard sequence controls over the actual generated module.
// `wake` here selects the guard protocol sequence, not a fabricated native flag.
// Actual NativeEnterOutput derives this boolean ONLY from its own returned flags.
test.each([
  'none',
  'wake',
  'query',
  'other-wake',
  'other-take',
  'extra-query',
  'throw-wake',
  'throw-take',
] as const)('exact transfer descriptor witness: %s', async (mode) => {
  const { ctor, create } = await fixture();
  const guard = installNativeSessionReceiverGuard(ctor, {
    active: () => false,
  });
  const first = create();
  const other = create();
  try {
    invoke(first, 'input', [SessionInputMsg.encode(emptyInput(1)), 100, 100]);
    const returned = guard.completedInputReturn(first);
    if (returned === undefined)
      throw new Error('Actual input return was not captured');
    const pointer = Object.getOwnPropertyDescriptor(first, '__wbg_ptr');
    const fault = (operation: 'wakeAt' | 'takeOutput') => {
      if (!pointer || !('value' in pointer))
        throw new Error('Missing actual native pointer descriptor');
      // Explicit fixture injection: original guarded callable really throws at bindgen.
      Object.defineProperty(first, '__wbg_ptr', { ...pointer, value: 0 });
      try {
        expect(() => invoke(first, operation)).toThrow();
      } finally {
        Object.defineProperty(first, '__wbg_ptr', pointer);
      }
    };
    if (mode === 'query') invoke(first, 'effectiveAccess');
    else if (mode === 'other-wake') invoke(other, 'wakeAt');
    else if (mode === 'throw-wake') fault('wakeAt');
    else if (mode !== 'none') invoke(first, 'wakeAt');
    if (mode === 'extra-query') invoke(first, 'effectiveAccess');
    if (mode === 'throw-take') fault('takeOutput');
    else invoke(mode === 'other-take' ? other : first, 'takeOutput');
    const wake = mode !== 'none';
    const matched = guard.completedOutputTransfer(returned, first, wake);
    if (mode === 'none' || mode === 'wake')
      expect(matched).toBe(guard.completedEntryToken());
    else {
      expect(matched).toBeUndefined();
      if (mode !== 'extra-query')
        // Counter-only +2 would incorrectly accept these substitutions/throws.
        expect(guard.completedEntryToken()).toBe(returned + 2n);
    }
    invoke(first, 'input', [SessionInputMsg.encode(emptyInput(1)), 101, 101]);
    const healthy = guard.completedInputReturn(first);
    if (healthy === undefined)
      throw new Error('Next actual input was not healthy');
    invoke(first, 'takeOutput');
    expect(guard.completedOutputTransfer(healthy, first, false)).toBe(
      guard.completedEntryToken()
    );
  } finally {
    try {
      invoke(first, 'free');
    } finally {
      invoke(other, 'free');
    }
  }
});

test('descriptor alias reuse cannot qualify as an unambiguous transfer operation', async () => {
  const { ctor, create } = await fixture();
  const descriptor = Object.getOwnPropertyDescriptor(
    ctor.prototype,
    'takeOutput'
  );
  if (!descriptor || typeof descriptor.value !== 'function')
    throw new Error('Missing actual transfer descriptor');
  Object.defineProperty(ctor.prototype, 'transferAlias', {
    ...descriptor,
    configurable: true,
  });
  const guard = installNativeSessionReceiverGuard(ctor, {
    active: () => false,
  });
  const session = create();
  try {
    invoke(session, 'input', [SessionInputMsg.encode(emptyInput(1)), 100, 100]);
    const returned = guard.completedInputReturn(session);
    if (returned === undefined) throw new Error('Missing actual input return');
    invoke(session, 'transferAlias');
    expect(guard.completedEntryToken()).toBe(returned + 1n);
    expect(
      guard.completedOutputTransfer(returned, session, false)
    ).toBeUndefined();
  } finally {
    invoke(session, 'free');
  }
  // Alias-bearing constructor stays conservative; fresh qualified modules are
  // covered by the normal actual-descriptor controls above, never wildcarded.
});

// Attribution controls; these rows grant no output/publication or semantic proof.
test('owned cleanup rows survive legacy reads and interleaved actual receivers', async () => {
  const { ctor, create } = await fixture();
  let fault: { readonly error: unknown } | undefined;
  const guard = installNativeSessionReceiverGuard(ctor, {
    active: () => false,
    afterReturn() {
      if (fault) {
        const current = fault;
        fault = undefined;
        throw current.error;
      }
    },
  });
  const own = create();
  const other = create();
  const cause = { own: 'cleanup' };
  const otherCause = { other: 'cleanup' };
  const completion = {};
  const ticket = guard.beginCleanupEntry(own, completion);
  try {
    fault = { error: cause };
    invoke(own, 'tick', [2, 2]);
    fault = { error: otherCause };
    invoke(other, 'tick', [2, 2]);
    expect(guard.takeCleanupFailure(own)).toBeUndefined();
    expect(() => guard.finishCleanupEntry(ticket, {})).toThrow('not owned');
    expect(guard.takeCleanupFailure(own)).toBeUndefined();
    const rows = guard.finishCleanupEntry(ticket, completion);
    expect(rows).toEqual([{ error: cause }]);
    // Private original callable references and completion metadata never escape.
    expect(Reflect.ownKeys(rows[0])).toEqual(['error']);
    expect(guard.takeCleanupFailure(other)?.error).toBe(otherCause);
    expect(guard.takeCleanupFailure()).toBeUndefined();
    const next = {};
    const healthy = guard.beginCleanupEntry(own, next);
    invoke(own, 'tick', [3, 3]);
    expect(guard.finishCleanupEntry(healthy, next)).toEqual([]);
  } finally {
    invoke(own, 'free');
    invoke(other, 'free');
  }
});

test.each([undefined, null, { opaque: 'native' }])(
  'owned real wrapper preserves opaque native failure and independent cleanup %j',
  async (primary) => {
    const { ctor, create } = await fixture();
    let fault: { readonly error: unknown } | undefined;
    const guard = installNativeSessionReceiverGuard(ctor, {
      active: () => false,
      afterReturn() {
        if (fault) {
          const current = fault;
          fault = undefined;
          throw current.error;
        }
      },
    });
    const session = create();
    try {
      for (const secondary of [undefined, null, { opaque: 'cleanup' }]) {
        const completion = {};
        const ticket = guard.beginCleanupEntry(session, completion);
        const badNow = {
          [Symbol.toPrimitive]() {
            throw primary;
          },
        };
        fault = { error: secondary };
        let caught: { readonly error: unknown } | undefined;
        try {
          invoke(session, 'viewCommandEnter', [badNow, 3]);
        } catch (error) {
          caught = { error };
        }
        expect(caught).toBeDefined();
        expect(caught?.error).toBe(primary);
        expect(guard.takeCleanupFailure(session)).toBeUndefined();
        expect(guard.finishCleanupEntry(ticket, completion)).toEqual([
          { error: secondary },
        ]);
        const next = {};
        const healthy = guard.beginCleanupEntry(session, next);
        invoke(session, 'tick', [4, 4]);
        expect(guard.finishCleanupEntry(healthy, next)).toEqual([]);
        expect(guard.takeCleanupFailure()).toBeUndefined();
      }
    } finally {
      invoke(session, 'free');
    }
  }
);

test('aliased actual descriptor keeps cleanup ownership without claiming a transfer role', async () => {
  const { ctor, create } = await fixture();
  const original = Object.getOwnPropertyDescriptor(ctor.prototype, 'input');
  if (!original) throw new Error('Missing actual input descriptor');
  Object.defineProperty(ctor.prototype, 'inputAlias', original);
  let fail = false;
  const cause = { alias: 'cleanup' };
  const guard = installNativeSessionReceiverGuard(ctor, {
    active: () => false,
    afterReturn() {
      if (fail) {
        fail = false;
        throw cause;
      }
    },
  });
  const session = create();
  try {
    const completion = {};
    const ticket = guard.beginCleanupEntry(session, completion);
    fail = true;
    invoke(session, 'inputAlias', [
      SessionInputMsg.encode(emptyInput(0)),
      2,
      2,
    ]);
    expect(guard.completedInputReturn(session)).toBeUndefined();
    expect(guard.takeCleanupFailure(session)).toBeUndefined();
    expect(guard.finishCleanupEntry(ticket, completion)).toEqual([
      { error: cause },
    ]);
    const next = {};
    const healthy = guard.beginCleanupEntry(session, next);
    invoke(session, 'tick', [3, 3]);
    expect(guard.finishCleanupEntry(healthy, next)).toEqual([]);
  } finally {
    invoke(session, 'free');
  }
});

test('installation rollback fault remains unowned and exposes no entry lease', () => {
  // Descriptor-only injected failure, not a generated native or proxy-transparency claim.
  class DescriptorFixture {
    static createA() {}
    static createB() {}
  }
  const primary = { install: 'fault' };
  const secondary = { rollback: 'fault' };
  let writes = 0;
  let armed = true;
  const guardedConstructor = new Proxy(DescriptorFixture, {
    defineProperty(target, key, descriptor) {
      writes++;
      if (armed && writes === 2) throw primary;
      if (armed && writes === 3) throw secondary;
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
  const hooks = { active: () => false };
  let caught: { readonly error: unknown } | undefined;
  try {
    installNativeSessionReceiverGuard(guardedConstructor, hooks);
  } catch (error) {
    caught = { error };
  }
  expect(caught).toBeDefined();
  expect(caught?.error).toBe(primary);
  armed = false;
  const guard = installNativeSessionReceiverGuard(guardedConstructor, hooks);
  const receiver = new DescriptorFixture();
  const completion = {};
  const ticket = guard.beginCleanupEntry(receiver, completion);
  expect(guard.finishCleanupEntry(ticket, completion)).toEqual([]);
  expect(guard.takeCleanupFailure()).toBeUndefined();
});

test('drain cleanup association belongs to each actual receiver and retires independently', async () => {
  const { ctor, create } = await fixture();
  let fault: { error: unknown } | undefined;
  const guard = installNativeSessionReceiverGuard(ctor, {
    active: () => false,
    afterReturn() {
      if (fault) {
        const current = fault;
        fault = undefined;
        throw current.error;
      }
    },
  });
  const first = create();
  const second = create();
  const outer = Object.freeze({ label: 'outer' });
  const inner = Object.freeze({ label: 'inner' });
  let firstDrain: object | undefined = outer;
  let secondDrain: object | undefined = inner;
  const firstCause = { receiver: 'first' };
  const secondCause = { receiver: 'second' };
  const outsideCause = { outside: true };
  const releaseFirst = guard.bindCleanupDrain(first, () => firstDrain);
  const releaseSecond = guard.bindCleanupDrain(second, () => secondDrain);
  try {
    expect(() => guard.bindCleanupDrain(first, () => inner)).toThrow(
      'already bound'
    );
    fault = { error: firstCause };
    invoke(first, 'tick', [2, 2]);
    fault = { error: secondCause };
    invoke(second, 'tick', [2, 2]);
    expect(guard.takeCleanupFailure(first)).toBeUndefined();
    expect(guard.takeCleanupFailure(first, inner)).toBeUndefined();
    expect(guard.takeCleanupFailure(second, outer)).toBeUndefined();
    expect(guard.takeCleanupFailure(second, inner)?.error).toBe(secondCause);
    // Collecting the nested receiver/fence never sweeps an older outer row.
    expect(guard.takeCleanupFailure(first, outer)?.error).toBe(firstCause);
    firstDrain = undefined;
    fault = { error: outsideCause };
    invoke(first, 'tick', [3, 3]);
    firstDrain = outer;
    expect(guard.takeCleanupFailure(first, outer)).toBeUndefined();
    expect(guard.takeCleanupFailure(first)?.error).toBe(outsideCause);
    releaseFirst();
    const replacement = guard.bindCleanupDrain(first, () => inner);
    try {
      releaseFirst(); // Old cleanup cannot retire the replacement binding.
      fault = { error: firstCause };
      invoke(first, 'tick', [4, 4]);
      expect(guard.takeCleanupFailure(first, inner)?.error).toBe(firstCause);
      fault = { error: secondCause };
      invoke(second, 'tick', [4, 4]);
      expect(guard.takeCleanupFailure(second, inner)?.error).toBe(secondCause);
      secondDrain = undefined;
      expect(guard.takeCleanupFailure(first)).toBeUndefined();
    } finally {
      replacement();
    }
  } finally {
    releaseFirst();
    releaseSecond();
    try {
      invoke(first, 'free');
    } finally {
      invoke(second, 'free');
    }
  }
});

test.each([undefined, null, { opaque: 'drain-getter' }])(
  'throwing drain getter preserves the original cleanup fault and does not tag older diagnostics %j',
  async (getterCause) => {
    const { ctor, create } = await fixture();
    let fault: { error: unknown } | undefined;
    const guard = installNativeSessionReceiverGuard(ctor, {
      active: () => false,
      afterReturn() {
        if (fault) {
          const current = fault;
          fault = undefined;
          throw current.error;
        }
      },
    });
    const session = create();
    const outside = { older: true };
    const primary = { actual: 'cleanup' };
    const frame = Object.freeze({ actual: 'drain' });
    let throws = true;
    try {
      fault = { error: outside };
      invoke(session, 'tick', [2, 2]);
      const release = guard.bindCleanupDrain(session, () => {
        if (throws) throw getterCause;
        return frame;
      });
      try {
        fault = { error: primary };
        invoke(session, 'tick', [3, 3]);
        expect(guard.takeCleanupFailure(session, frame)).toBeUndefined();
        expect(guard.takeCleanupFailure(session)?.error).toBe(outside);
        expect(guard.takeCleanupFailure(session)?.error).toBe(primary);
        const getterFailure = guard.takeCleanupFailure(session);
        expect(getterFailure).toBeDefined();
        expect(getterFailure?.error).toBe(getterCause);
        expect(guard.takeCleanupFailure(session)).toBeUndefined();
        throws = false;
        invoke(session, 'tick', [4, 4]);
        expect(guard.takeCleanupFailure(session, frame)).toBeUndefined();
        fault = { error: primary };
        invoke(session, 'tick', [5, 5]);
        expect(guard.takeCleanupFailure(session, frame)?.error).toBe(primary);
        expect(guard.takeCleanupFailure(session)).toBeUndefined();
      } finally {
        release();
      }
    } finally {
      invoke(session, 'free');
    }
  }
);
