/** The actual generated constructor is supplied by its owning module binding. */
export interface NativeSessionConstructor {
  readonly prototype: object;
}

export interface NativeSessionReceiverHooks {
  readonly active: () => boolean;
  /** Pure JS cleanup only: no native calls, output consumption or acknowledgement. */
  readonly afterReturn?: () => void;
}

export interface NativeSessionReceiverGuard {
  /** Pure JS accepted-wrapper completion count; not native admission or output ACK. */
  readonly completedEntryToken: () => bigint;
  /** Read secondary cleanup failures only after the normal native output drain. */
  readonly takeCleanupFailure: () => { readonly error: unknown } | undefined;
}

type Callable = (this: unknown, ...args: unknown[]) => unknown;
interface Installation {
  readonly active: () => boolean;
  readonly blocked: () => boolean;
  readonly afterReturn: (() => void) | undefined;
  readonly controller: NativeSessionReceiverGuard;
}
interface Change {
  readonly target: object;
  readonly key: PropertyKey;
  readonly original: PropertyDescriptor;
  readonly replacement: PropertyDescriptor;
}
const installations = new WeakMap<object, Installation>();

/** Reject queued receiver work using only an already installed module authority. */
export function assertNativeSessionReceiverAdmission(session: object): void {
  const prototype: unknown = Object.getPrototypeOf(session);
  if (typeof prototype !== 'object' || prototype === null) return;
  const sessionConstructor: unknown = Object.getOwnPropertyDescriptor(
    prototype,
    'constructor'
  )?.value;
  if (typeof sessionConstructor !== 'function') return;
  if (installations.get(sessionConstructor)?.blocked())
    throw new Error(
      'Ordinary native admission during scoped callback or cleanup'
    );
}

function callable(value: unknown): value is Callable {
  return typeof value === 'function';
}

function validateHooks(active: unknown, afterReturn: unknown): void {
  if (
    !callable(active) ||
    (afterReturn !== undefined && !callable(afterReturn))
  )
    throw new Error('Invalid native session receiver hooks');
}

/**
 * Fence generated receiver wrappers before wasm-bindgen borrows their session.
 * Descriptor inspection is not a WASM brand witness: the caller must bind the
 * actual module constructor and actual instances. Nested work uses issued free
 * scoped functions, never an ordinary receiver on this or another session.
 * Installation is permanent; equal hook functions share the same controller.
 */
export function installNativeSessionReceiverGuard(
  nativeConstructor: NativeSessionConstructor,
  hooks: NativeSessionReceiverHooks
): NativeSessionReceiverGuard {
  const { active, afterReturn } = hooks;
  const existing = installations.get(nativeConstructor);
  if (existing) {
    if (existing.active !== active || existing.afterReturn !== afterReturn)
      throw new Error('Native session receiver guard has different hooks');
    return existing.controller;
  }
  validateHooks(active, afterReturn);
  if (typeof nativeConstructor !== 'function')
    throw new Error('Expected the actual generated native session constructor');
  if (active())
    throw new Error('Cannot install a native session guard during a callback');
  const prototype: unknown = Object.getOwnPropertyDescriptor(
    nativeConstructor,
    'prototype'
  )?.value;
  if (typeof prototype !== 'object' || prototype === null)
    throw new Error('Native session constructor has no own prototype');

  let depth = 0;
  let cleaning = false;
  const cleanupFailures: { readonly error: unknown }[] = [];
  let completedEntries = 0n;
  const controller: NativeSessionReceiverGuard = Object.freeze({
    completedEntryToken: () => completedEntries,
    takeCleanupFailure: () => cleanupFailures.shift(),
  });
  const wrappers = new Map<Callable, Callable>();
  function wrap(original: Callable): Callable {
    const existing = wrappers.get(original);
    if (existing) return existing;
    // A method wrapper remains non-constructible, like generated class methods.
    const wrapper = {
      invoke(this: unknown, ...args: unknown[]): unknown {
        if (active() || cleaning)
          throw new Error(
            'Native session receiver call during scoped callback or cleanup'
          );
        depth++;
        try {
          return Reflect.apply(original, this, args);
        } finally {
          depth--;
          if (depth === 0) {
            if (afterReturn !== undefined) {
              cleaning = true;
              try {
                afterReturn();
              } catch (error) {
                // Preserve both native return flags and primary opaque exceptions.
                cleanupFailures.push({ error });
              } finally {
                cleaning = false;
              }
            }
            completedEntries += 1n;
          }
        }
      },
    }.invoke;
    Object.defineProperties(wrapper, {
      name: { value: original.name, configurable: true },
      length: { value: original.length, configurable: true },
    });
    wrappers.set(original, wrapper);
    return wrapper;
  }
  const changes: Change[] = [];
  function prepare(target: object, key: PropertyKey): void {
    const original = Object.getOwnPropertyDescriptor(target, key);
    if (!original) throw new Error('Native session descriptor disappeared');
    const value: unknown = original.value;
    const get: unknown = original.get;
    const set: unknown = original.set;
    let replacement: PropertyDescriptor;
    if (callable(value)) {
      if (!original.configurable && !original.writable)
        throw new Error('Native session method cannot be guarded');
      replacement = { ...original, value: wrap(value) };
    } else if (callable(get) || callable(set)) {
      if (!original.configurable)
        throw new Error('Native session accessor cannot be guarded');
      replacement = {
        ...original,
        get: callable(get) ? wrap(get) : undefined,
        set: callable(set) ? wrap(set) : undefined,
      };
    } else return;
    changes.push({ target, key, original, replacement });
  }
  // Complete preflight, including static root admissions, before changing either.
  for (const key of Reflect.ownKeys(prototype))
    if (key !== 'constructor') prepare(prototype, key);
  for (const key of Reflect.ownKeys(nativeConstructor))
    if (
      typeof key === 'string' &&
      (key.startsWith('create') || key === 'validateHostedCallbacks')
    )
      prepare(nativeConstructor, key);

  const attempted: Change[] = [];
  try {
    for (const change of changes) {
      attempted.push(change);
      Object.defineProperty(change.target, change.key, change.replacement);
    }
  } catch (error) {
    for (const change of attempted.reverse()) {
      try {
        Object.defineProperty(change.target, change.key, change.original);
      } catch (rollbackError) {
        cleanupFailures.push({ error: rollbackError });
      }
    }
    throw error;
  }
  installations.set(nativeConstructor, {
    active,
    blocked: () => active() || cleaning,
    afterReturn,
    controller,
  });
  return controller;
}
