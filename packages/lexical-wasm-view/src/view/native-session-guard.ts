import { recordGuardedInputCommitCorrelation } from './input-commit-correlation';

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
  /** Actual successful guarded input return, including its cleanup boundary. */
  readonly completedInputReturn: (session: object) => bigint | undefined;
  /** Exact local transfer sequence; not native handling or publication evidence. */
  readonly completedOutputTransfer: (
    returned: bigint,
    session: object,
    wakeChanged: boolean
  ) => bigint | undefined;
  /** Read secondary cleanup failures only after the normal native output drain. */
  readonly takeCleanupFailure: (
    receiver?: object,
    drain?: object
  ) => { readonly error: unknown } | undefined;
  /** Fixed receiver ownership; never native admission or publication authority. */
  readonly bindCleanupDrain: (
    receiver: object,
    current: () => object | undefined
  ) => () => void;
  /** Attribution only: no receipt, publication, editing or native authority. */
  readonly beginCleanupEntry: (receiver: object, completion: object) => object;
  readonly takeCleanupEntryFailures: (
    ticket: object,
    completion: object
  ) => readonly { readonly error: unknown }[];
  readonly finishCleanupEntry: (
    ticket: object,
    completion: object
  ) => readonly { readonly error: unknown }[];
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
  interface CleanupEntry {
    readonly receiver: object;
    readonly completion: object;
    readonly start: bigint;
  }
  interface CleanupFailure {
    readonly error: unknown;
    /** Only runtime wrapper failures have a completion; installation faults do not. */
    readonly call?: {
      readonly receiver: unknown;
      readonly operation: Callable;
      readonly token: bigint;
      readonly returned: boolean;
    };
    readonly entry?: object;
    readonly drain?: object;
  }
  const cleanupDrains = new WeakMap<object, () => object | undefined>();
  const cleanupFailures: CleanupFailure[] = [];
  const cleanupEntries = new Map<object, CleanupEntry>();
  let completedEntries = 0n;
  const transferKinds = new WeakMap<
    Callable,
    'input' | 'wakeAt' | 'takeOutput'
  >();
  const ambiguousTransfers = new WeakSet<Callable>();
  const descriptorUses = new WeakMap<Callable, number>();
  const recentCompletions: {
    token: bigint;
    receiver: unknown;
    kind: 'input' | 'wakeAt' | 'takeOutput' | undefined;
    succeeded: boolean;
  }[] = [];
  function cleanupEntryFailures(
    ticket: object,
    completion: object,
    close: boolean
  ) {
    const entry = cleanupEntries.get(ticket);
    if (!entry || entry.completion !== completion)
      throw new Error('Native cleanup entry is not owned');
    const end = completedEntries;
    if (close) cleanupEntries.delete(ticket);
    const selected: CleanupFailure[] = [];
    for (let index = cleanupFailures.length - 1; index >= 0; index--) {
      const row = cleanupFailures[index];
      if (row.entry !== ticket) continue;
      if (
        !row.call ||
        row.call.receiver !== entry.receiver ||
        row.call.token <= entry.start ||
        row.call.token > end
      )
        throw new Error('Native cleanup completion is outside its entry');
      selected.unshift(...cleanupFailures.splice(index, 1));
    }
    // Original native callable identities remain private to the guard closure.
    return selected.map((row) => ({ error: row.error }));
  }
  const controller: NativeSessionReceiverGuard = Object.freeze({
    completedEntryToken: () => completedEntries,
    completedInputReturn: (session: object) => {
      const completion = recentCompletions.at(-1);
      return completion?.token === completedEntries &&
        completion.receiver === session &&
        completion.kind === 'input' &&
        completion.succeeded
        ? completedEntries
        : undefined;
    },
    completedOutputTransfer: (
      returned: bigint,
      session: object,
      wakeChanged: boolean
    ) => {
      const count = wakeChanged ? 2 : 1;
      if (completedEntries !== returned + BigInt(count)) return undefined;
      const sequence = recentCompletions.slice(-count);
      if (sequence.length !== count) return undefined;
      for (let index = 0; index < count; index++) {
        const completion = sequence[index];
        const kind = wakeChanged && index === 0 ? 'wakeAt' : 'takeOutput';
        if (
          completion.token !== returned + BigInt(index + 1) ||
          completion.receiver !== session ||
          completion.kind !== kind ||
          !completion.succeeded
        )
          return undefined;
      }
      return completedEntries;
    },
    takeCleanupFailure: (receiver?: object, drain?: object) => {
      const index = cleanupFailures.findIndex(
        (row) =>
          row.entry === undefined &&
          row.drain === drain &&
          (receiver === undefined ||
            row.call === undefined ||
            row.call.receiver === receiver)
      );
      if (index === -1) return;
      const row = cleanupFailures.splice(index, 1)[0];
      return { error: row.error };
    },
    bindCleanupDrain: (receiver: object, current: () => object | undefined) => {
      if (cleanupDrains.has(receiver))
        throw new Error('Native cleanup receiver already bound');
      cleanupDrains.set(receiver, current);
      return () => {
        if (cleanupDrains.get(receiver) === current)
          cleanupDrains.delete(receiver);
      };
    },
    beginCleanupEntry: (receiver: object, completion: object) => {
      if (
        [...cleanupEntries.values()].some(
          (entry) => entry.receiver === receiver
        )
      )
        throw new Error('Native cleanup entry already active');
      const ticket = {};
      cleanupEntries.set(ticket, {
        receiver,
        completion,
        start: completedEntries,
      });
      return ticket;
    },
    takeCleanupEntryFailures: (ticket: object, completion: object) =>
      cleanupEntryFailures(ticket, completion, false),
    finishCleanupEntry: (ticket: object, completion: object) =>
      cleanupEntryFailures(ticket, completion, true),
  });
  const wrappers = new Map<Callable, Callable>();
  const inputCommitReceivers = new WeakSet<Callable>();
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
        if (inputCommitReceivers.has(original))
          recordGuardedInputCommitCorrelation(this, args[3]);
        depth++;
        let succeeded = false;
        const cleanupCount = cleanupFailures.length;
        try {
          const result = Reflect.apply(original, this, args);
          succeeded = true;
          return result;
        } finally {
          depth--;
          if (depth === 0) {
            // cleaning forbids guarded reentry; assign THIS wrapper's completion
            // before its cleanup runs, never from a later caller's token read.
            const token = completedEntries + 1n;
            if (afterReturn !== undefined) {
              cleaning = true;
              try {
                afterReturn();
              } catch (error) {
                // Preserve both native return flags and primary opaque exceptions.
                const entry = [...cleanupEntries].find(
                  ([, owner]) => owner.receiver === this
                )?.[0];
                let drain: object | undefined;
                let contextFailure: { readonly error: unknown } | undefined;
                if (
                  !entry &&
                  ((typeof this === 'object' && this !== null) ||
                    typeof this === 'function')
                ) {
                  try {
                    drain = cleanupDrains.get(this)?.();
                  } catch (error) {
                    contextFailure = { error };
                  }
                }
                cleanupFailures.push({
                  error,
                  entry,
                  drain,
                  call: {
                    receiver: this,
                    operation: original,
                    token,
                    returned: succeeded,
                  },
                });
                // A context getter failure cannot replace the original opaque
                // cleanup fault or falsely assign either diagnostic to an input.
                if (contextFailure)
                  cleanupFailures.push({
                    error: contextFailure.error,
                    call: {
                      receiver: this,
                      operation: original,
                      token,
                      returned: succeeded,
                    },
                  });
              } finally {
                cleaning = false;
              }
            }
            completedEntries = token;
            recentCompletions.push({
              token: completedEntries,
              receiver: this,
              kind: transferKinds.get(original),
              succeeded: succeeded && cleanupFailures.length === cleanupCount,
            });
            if (recentCompletions.length > 2) recentCompletions.shift();
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
      const uses = (descriptorUses.get(value) ?? 0) + 1;
      descriptorUses.set(value, uses);
      if (uses > 1) {
        ambiguousTransfers.add(value);
        transferKinds.delete(value);
      }
      if (!original.configurable && !original.writable)
        throw new Error('Native session method cannot be guarded');
      if (target === prototype && key === 'inputObserved')
        inputCommitReceivers.add(value);
      if (
        target === prototype &&
        (key === 'input' || key === 'wakeAt' || key === 'takeOutput') &&
        !ambiguousTransfers.has(value)
      )
        transferKinds.set(value, key);
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
