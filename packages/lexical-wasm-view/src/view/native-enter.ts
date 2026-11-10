import {
  EditorInputMsg,
  type ISelectionMsg,
  ListenerTableMsg,
  SelectionMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import type * as Native from '@macro-inc/collaboration/session/wasm';
import type { ViewCommandPriority } from './commands';
import { installNativeSessionReceiverGuard } from './native-session-guard';

/** Supply the actual generated ordinary module, never a capability-shaped shim. */
export type NativeEnterModule = Pick<
  typeof Native,
  | 'EditorSession'
  | 'installViewCommandHost'
  | 'requestRetireViewObservation'
  | 'viewCommandScopeDispatch'
  | 'viewCommandScopeEnter'
  | 'viewCommandScopeOwnJSON'
  | 'viewCommandScopeRegisterEnter'
  | 'viewCommandScopeSelection'
  | 'viewCommandScopeSetSelection'
  | 'viewCommandScopeText'
  | 'viewCommandScopeUnregisterEnter'
>;

export interface NativeEnterScope {
  readonly owner: bigint;
  readonly invocation: bigint;
  readonly scope: bigint;
  readonly generation: number;
  readonly access: number;
}

interface Callback {
  readonly owner: bigint;
  readonly invoke: (event: KeyboardEvent | null) => boolean;
}
interface Failure extends NativeEnterScope {
  readonly error: unknown;
}
interface KeyboardAdmission {
  readonly owner: bigint;
  readonly event: KeyboardEvent;
  invocation?: bigint;
}
interface Registration {
  readonly id: bigint;
  readonly handle: bigint;
}
interface Collection {
  readonly buckets: Map<ViewCommandPriority, Map<object, Registration>>;
}
interface OwnerListeners {
  readonly native: boolean;
  collection?: Collection;
}

const modules = new WeakMap<object, NativeEnterDispatcher>();
const failedModules = new WeakMap<object, { readonly error: unknown }>();
const moduleFunctions: readonly (keyof NativeEnterModule)[] = [
  'installViewCommandHost',
  'requestRetireViewObservation',
  'viewCommandScopeDispatch',
  'viewCommandScopeEnter',
  'viewCommandScopeOwnJSON',
  'viewCommandScopeRegisterEnter',
  'viewCommandScopeSelection',
  'viewCommandScopeSetSelection',
  'viewCommandScopeText',
  'viewCommandScopeUnregisterEnter',
];

/** Module-wide invocation state; output/lease consumption belongs to its owner. */
export class NativeEnterDispatcher {
  private readonly callbacks = new Map<bigint, Callback>();
  private readonly retiredCallbacks = new Set<bigint>();
  private readonly scopes: NativeEnterScope[] = [];
  private readonly keyboard: KeyboardAdmission[] = [];
  private readonly failures = new Map<bigint, Failure>();
  private readonly sessions = new WeakMap<Native.EditorSession, bigint>();
  private readonly owners = new Map<bigint, Native.EditorSession>();
  private readonly listeners = new Map<bigint, OwnerListeners>();
  private nextCallback = 1n;
  private teardowns: (() => void)[] = [];
  readonly guard;

  private readonly active = () => this.scopes.length !== 0;
  private readonly afterReturn = () => {
    for (const id of this.retiredCallbacks) this.callbacks.delete(id);
    this.retiredCallbacks.clear();
  };

  private constructor(private readonly native: NativeEnterModule) {
    // Read-only descriptor preflight must precede native host ownership.
    for (const target of [
      native.EditorSession.prototype,
      native.EditorSession,
    ]) {
      for (const key of Reflect.ownKeys(target)) {
        if (target === native.EditorSession) {
          if (typeof key !== 'string' || !key.startsWith('create')) continue;
        } else if (key === 'constructor') continue;
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor)
          throw new Error('Native receiver descriptor disappeared');
        const value: unknown = descriptor.value;
        if (
          (typeof value === 'function' &&
            !descriptor.configurable &&
            !descriptor.writable) ||
          ((descriptor.get || descriptor.set) && !descriptor.configurable)
        )
          throw new Error('Native receiver descriptor cannot be guarded');
      }
    }
    native.installViewCommandHost(this.dispatch, this.lookup);
    this.guard = installNativeSessionReceiverGuard(native.EditorSession, {
      active: this.active,
      afterReturn: this.afterReturn,
    });
  }

  static forModule(native: NativeEnterModule): NativeEnterDispatcher {
    const existing = modules.get(native.EditorSession);
    if (existing) {
      for (const name of moduleFunctions)
        if (existing.native[name] !== native[name])
          throw new Error('Native Enter module does not match its constructor');
      return existing;
    }
    const failed = failedModules.get(native.EditorSession);
    if (failed) throw failed.error;
    try {
      const dispatcher = new NativeEnterDispatcher(native);
      modules.set(native.EditorSession, dispatcher);
      return dispatcher;
    } catch (error) {
      // Terminal consumer binding only; do not claim raw factories are fenced.
      failedModules.set(native.EditorSession, { error });
      throw error;
    }
  }

  owner(session: Native.EditorSession): bigint {
    this.assertRootAdmission();
    if (
      !(session instanceof this.native.EditorSession) ||
      Object.getPrototypeOf(session) !== this.native.EditorSession.prototype
    )
      throw new Error('Native Enter session belongs to another module');
    const owner = session.viewCommandOwner();
    if (owner <= 0n) throw new Error('Native Enter owner is invalid');
    const previous = this.sessions.get(session);
    if (previous !== undefined && previous !== owner)
      throw new Error('Native Enter session owner changed');
    const bound = this.owners.get(owner);
    if (bound && bound !== session)
      throw new Error(
        'Native Enter owner already has an actual session binding'
      );
    let listeners: OwnerListeners | undefined;
    if (!this.listeners.has(owner)) {
      const table = ListenerTableMsg.decode(session.listenerTable());
      listeners = {
        native: table.rows.some(
          (row) => row.command === 'Key(Enter)' && row.priority !== 0
        ),
      };
    }
    this.sessions.set(session, owner);
    this.owners.set(owner, session);
    if (listeners) this.listeners.set(owner, listeners);
    return owner;
  }

  /** Ports call this before queueing any unsupported ordinary root operation. */
  assertRootAdmission(): void {
    if (this.active())
      throw new Error('Ordinary native admission during scoped callback');
  }

  current(owner: bigint): NativeEnterScope | undefined {
    const scope = this.scopes.at(-1);
    if (scope && scope.owner !== owner)
      throw new Error('Native Enter scope belongs to another owner');
    return scope;
  }
  activeScope(): NativeEnterScope | undefined {
    return this.scopes.at(-1);
  }
  deferTeardown(cleanup: () => void): void {
    if (!this.active())
      throw new Error('Deferred teardown requires an active native callback');
    this.teardowns.push(cleanup);
  }
  takeTeardowns(): (() => void)[] {
    this.assertRootAdmission();
    const pending = this.teardowns;
    this.teardowns = [];
    return pending;
  }

  private requireScope(owner: bigint): NativeEnterScope {
    const scope = this.current(owner);
    if (!scope) throw new Error('Native Enter operation lacks an issued scope');
    return scope;
  }

  pendingSelection(owner: bigint): ISelectionMsg {
    return SelectionMsg.decode(
      this.native.viewCommandScopeSelection(this.requireScope(owner).scope)
    );
  }

  setPendingSelection(owner: bigint, selection: ISelectionMsg): void {
    this.native.viewCommandScopeSetSelection(
      this.requireScope(owner).scope,
      SelectionMsg.encode(selection)
    );
  }

  pendingText(owner: bigint, key: number): string {
    return this.native.viewCommandScopeText(
      this.requireScope(owner).scope,
      key
    );
  }

  pendingOwnJSON(owner: bigint, key: number): string {
    return this.native.viewCommandScopeOwnJSON(
      this.requireScope(owner).scope,
      key
    );
  }

  dispatchScoped(owner: bigint, input: EditorInputMsg): boolean {
    return this.native.viewCommandScopeDispatch(
      this.requireScope(owner).scope,
      EditorInputMsg.encode(input)
    );
  }

  enterScoped(owner: bigint): boolean {
    return this.native.viewCommandScopeEnter(this.requireScope(owner).scope);
  }

  requestRetirement(owner: bigint): void {
    const current = this.requireScope(owner);
    this.native.requestRetireViewObservation(
      current.owner,
      current.invocation,
      current.scope
    );
  }

  /** Called inside a successful runSync admission, never while waiting in FIFO. */
  withKeyboardEvent<T>(owner: bigint, event: KeyboardEvent, call: () => T): T {
    if (this.active() || this.keyboard.length !== 0)
      throw new Error('Native keyboard admission is already active');
    const admission: KeyboardAdmission = { owner, event };
    this.keyboard.push(admission);
    try {
      return call();
    } finally {
      this.keyboard.pop();
    }
  }

  register(
    session: Native.EditorSession,
    owner: bigint,
    invoke: Callback['invoke'],
    priority: ViewCommandPriority,
    identity: object = invoke
  ): () => void {
    if (this.sessions.get(session) !== owner)
      throw new Error('Native Enter registration lacks its bound session');
    const listeners = this.listeners.get(owner);
    if (!listeners)
      throw new Error('Native Enter owner has no listener collection');
    const collection = listeners.collection ?? { buckets: new Map() };
    listeners.collection = collection;
    const bucket =
      collection.buckets.get(priority) ?? new Map<object, Registration>();
    collection.buckets.set(priority, bucket);
    if (!bucket.has(identity)) {
      if (this.nextCallback > 0xffffffffffffffffn)
        throw new Error('Native Enter callback identity exhausted');
      const id = this.nextCallback++;
      this.callbacks.set(id, { owner, invoke });
      try {
        const scope = this.current(owner);
        const handle = scope
          ? this.native.viewCommandScopeRegisterEnter(scope.scope, id, priority)
          : session.registerViewEnter(id, priority);
        bucket.set(identity, { id, handle });
      } catch (error) {
        this.callbacks.delete(id);
        throw error;
      }
    }
    return () => {
      const entry = bucket.get(identity);
      if (entry) {
        this.remove(session, owner, entry);
        bucket.delete(identity);
      }
      if (
        !listeners.native &&
        [...collection.buckets.values()].every((bucket) => bucket.size === 0)
      ) {
        // Source cleanup closes over its collection, then deletes the command map.
        if (listeners.collection && listeners.collection !== collection)
          this.removeCollection(session, owner, listeners.collection);
        listeners.collection = undefined;
      }
    };
  }

  private remove(
    session: Native.EditorSession,
    owner: bigint,
    entry: Registration
  ): void {
    const scope = this.current(owner);
    if (scope) {
      this.native.viewCommandScopeUnregisterEnter(scope.scope, entry.handle);
      this.retiredCallbacks.add(entry.id);
    } else {
      session.unregisterViewEnter(entry.handle);
      this.callbacks.delete(entry.id);
    }
  }

  private removeCollection(
    session: Native.EditorSession,
    owner: bigint,
    collection: Collection
  ): void {
    for (const bucket of collection.buckets.values()) {
      for (const entry of bucket.values()) this.remove(session, owner, entry);
      bucket.clear();
    }
  }

  hasListeners(owner: bigint): boolean {
    const collection = this.listeners.get(owner)?.collection;
    return (
      collection !== undefined &&
      [...collection.buckets.values()].some((bucket) => bucket.size !== 0)
    );
  }

  unregisterOwner(session: Native.EditorSession, owner: bigint): void {
    const listeners = this.listeners.get(owner);
    if (listeners?.collection)
      this.removeCollection(session, owner, listeners.collection);
  }

  releaseOwner(session: Native.EditorSession, owner: bigint): void {
    this.assertRootAdmission();
    const bound = this.owners.get(owner);
    if (!bound) return;
    if (bound !== session)
      throw new Error('Native Enter terminal owner does not match its session');
    // The caller has settled terminal native close, including failed cleanup.
    for (const [id, callback] of this.callbacks) {
      if (callback.owner === owner) {
        this.callbacks.delete(id);
        this.retiredCallbacks.delete(id);
      }
    }
    this.listeners.delete(owner);
    this.owners.delete(owner);
    this.sessions.delete(session);
    this.clearFailures(owner);
  }

  /** Presence retains throw undefined; consumers resolve only actual issued leases. */
  failure(
    owner: bigint,
    invocation: bigint,
    scope: bigint
  ): Failure | undefined {
    const failure = this.failures.get(scope);
    if (
      failure &&
      (failure.owner !== owner || failure.invocation !== invocation)
    )
      throw new Error('Native Enter failure identity mismatch');
    return failure;
  }

  hasFailures(owner: bigint): boolean {
    for (const failure of this.failures.values())
      if (failure.owner === owner) return true;
    return false;
  }

  hasFailure(owner: bigint, invocation: bigint, scope: bigint): boolean {
    const failure = this.failures.get(scope);
    return (
      failure !== undefined &&
      failure.owner === owner &&
      failure.invocation === invocation
    );
  }

  /** Only after the owner has drained output and resolved every issued lease. */
  clearFailures(owner: bigint): void {
    if (this.active()) throw new Error('Cannot clear an active callback cause');
    for (const [scope, failure] of this.failures)
      if (failure.owner === owner) this.failures.delete(scope);
  }

  private readonly dispatch = (
    owner: bigint,
    callback: bigint,
    invocation: bigint,
    scope: bigint,
    generation: number,
    access: number,
    programmatic: boolean
  ): boolean => {
    const current = { owner, invocation, scope, generation, access };
    this.scopes.push(current);
    try {
      const entry = this.callbacks.get(callback);
      if (!entry || entry.owner !== owner)
        throw new Error('Native Enter callback identity is unavailable');
      let event: KeyboardEvent | null = null;
      if (!programmatic) {
        const admission = this.keyboard.at(-1);
        if (!admission || admission.owner !== owner)
          throw new Error('Native keyboard callback lacks its admitted event');
        if (admission.invocation === undefined)
          admission.invocation = invocation;
        else if (admission.invocation !== invocation)
          throw new Error(
            'Native keyboard event belongs to another invocation'
          );
        event = admission.event;
      }
      const handled = entry.invoke(event);
      if (typeof handled !== 'boolean')
        throw new Error('Native Enter callback must return boolean');
      return handled;
    } catch (error) {
      this.failures.set(scope, { ...current, error });
      throw error;
    } finally {
      this.scopes.pop();
    }
  };

  private readonly lookup = (
    owner: bigint,
    invocation: bigint,
    scope: bigint
  ): unknown => {
    const failure = this.failure(owner, invocation, scope);
    if (!failure) throw new Error('Native Enter failure cause is unavailable');
    return failure.error;
  };
}
