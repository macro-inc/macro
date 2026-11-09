import { foreignHooks } from '../hooks.generated';

export type NodeKind = 'Element' | 'Text' | 'Decorator' | 'LineBreak' | 'Root';
export type NodeClass = Function & { readonly prototype: object };
export interface NativeNodeClass {
  readonly klass: NodeClass;
  readonly kind: NodeKind;
  /** null marks an abstract shim base with no registered serialized type. */
  readonly type?: string | null;
}
export interface NodeRegistration {
  readonly klass: NodeClass;
  readonly type: string;
  readonly kind: NodeKind;
  readonly ancestry: readonly string[];
  readonly extends: string | null;
  readonly native: NodeClass;
  readonly overrides: bigint;
}
interface NativeEntry extends NativeNodeClass {
  readonly type: string | null;
  readonly methods: readonly unknown[];
}
interface Registration extends Omit<NodeRegistration, 'overrides'> {
  overrides: bigint;
  readonly baseline: NativeEntry;
}
interface HookSlot {
  readonly owners: Set<WeakRef<RegistryState>>;
}
// Prototype metadata only: neither node instances nor editors are retained here.
const slots = new WeakMap<object, Map<string, HookSlot>>();

function typeName(klass: NodeClass): string {
  const getType: unknown = Reflect.get(klass, 'getType');
  if (typeof getType !== 'function')
    throw new TypeError('node class requires static getType()');
  const name: unknown = Reflect.apply(getType, klass, []);
  if (typeof name !== 'string' || name.length === 0)
    throw new TypeError('node getType() must return a nonempty string');
  return name;
}
function target(klass: NodeClass, isStatic: boolean): object {
  return isStatic ? klass : klass.prototype;
}
function method(klass: NodeClass, index: number): unknown {
  const hook = foreignHooks[index];
  return Reflect.get(target(klass, hook.static), hook.name);
}
function parent(klass: NodeClass): NodeClass | null {
  const value: unknown = Object.getPrototypeOf(klass);
  if (typeof value !== 'function' || !('prototype' in value)) return null;
  return value;
}

/** Capture native implementations before installing traps or applying JS patches. */
export class NativeNodeCatalog {
  private readonly entries = new Map<NodeClass, NativeEntry>();
  private readonly types = new Map<string, NodeClass>();

  constructor(classes: readonly NativeNodeClass[]) {
    for (const { klass, kind, type: declaredType } of classes) {
      if (this.entries.has(klass))
        throw new TypeError('duplicate native node class');
      const type = declaredType === undefined ? typeName(klass) : declaredType;
      if (type !== null) {
        if (this.types.has(type))
          throw new TypeError(`duplicate native node type ${type}`);
        this.types.set(type, klass);
      }
      this.entries.set(
        klass,
        Object.freeze({
          klass,
          kind,
          type,
          methods: Object.freeze(foreignHooks.map((_, i) => method(klass, i))),
        })
      );
    }
  }

  typeOf(klass: NodeClass): string | undefined {
    return this.entries.get(klass)?.type ?? undefined;
  }

  nativeType(type: string): NodeClass | undefined {
    return this.types.get(type);
  }

  nearest(klass: NodeClass): NativeEntry {
    let current: NodeClass | null = klass;
    while (current !== null) {
      const entry = this.entries.get(current);
      if (entry !== undefined) return entry;
      current = parent(current);
    }
    throw new TypeError(`node ${typeName(klass)} has no native ancestor`);
  }
}

class RegistryState {
  readonly records = new Map<NodeClass, Registration>();
  started = false;
  disposed = false;
  dirty = true;
  revision = 0;

  prepare(): readonly (readonly [Registration, bigint])[] {
    const pending: [Registration, bigint][] = [];
    for (const record of this.records.values()) {
      let mask = 0n;
      for (let i = 0; i < foreignHooks.length; i++) {
        const hook = foreignHooks[i];
        // S1 kind-specific non-hooks retain native behavior even if a subclass
        // defines an identically named method. Static transform is reserved.
        if (hook.name === 'getTextContent' && record.kind !== 'Decorator')
          continue;
        if (hook.name === 'setFormat' && record.kind !== 'Text') continue;
        if (
          hook.name === 'isInline' &&
          (record.kind === 'Text' || record.kind === 'LineBreak')
        )
          continue;
        if (
          record.baseline.methods[i] === undefined &&
          hook.name !== 'transform'
        )
          continue;
        if (method(record.klass, i) !== record.baseline.methods[i])
          mask |= 1n << BigInt(i);
      }
      const added = mask & ~record.overrides;
      if (this.started && added !== 0n) {
        const index = foreignHooks.findIndex(
          (_, i) => (added & (1n << BigInt(i))) !== 0n
        );
        throw new Error(
          `cannot override native hook ${foreignHooks[index].name} on ${record.type} after the first update`
        );
      }
      pending.push([record, mask]);
    }
    return pending;
  }

  refresh(): void {
    if (this.dirty) this.apply(this.prepare());
  }

  apply(pending: readonly (readonly [Registration, bigint])[]): void {
    for (const [record, mask] of pending) record.overrides = mask;
    this.dirty = false;
    this.revision++;
  }
}

function blocksInheritedWrite(owner: object, name: string): boolean {
  let inherited: object | null = Object.getPrototypeOf(owner);
  while (inherited !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(inherited, name);
    if (descriptor !== undefined) {
      if (descriptor.writable === false) return true;
      if (descriptor.get || descriptor.set) {
        const slot = slots.get(inherited)?.get(name);
        return slot === undefined || descriptor.set !== setters.get(slot);
      }
      return false;
    }
    inherited = Object.getPrototypeOf(inherited);
  }
  return false;
}

function watch(owner: object, name: string, registry: RegistryState): void {
  let methods = slots.get(owner);
  const existing = methods?.get(name);
  // A descriptor replacement (including vi.spyOn) may have removed our trap.
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (
    existing !== undefined &&
    descriptor?.set === setters.get(existing) &&
    descriptor?.get === getters.get(existing)
  ) {
    for (const reference of existing.owners) {
      const state = reference.deref();
      if (state === registry) return;
      if (state === undefined || state.disposed)
        existing.owners.delete(reference);
    }
    existing.owners.add(new WeakRef(registry));
    return;
  }
  // User accessors retain their semantics; refresh observes them before updates.
  if (
    descriptor?.configurable === false ||
    descriptor?.writable === false ||
    descriptor?.get ||
    descriptor?.set ||
    (descriptor === undefined &&
      (!Object.isExtensible(owner) || blocksInheritedWrite(owner, name)))
  )
    return;
  let written = descriptor !== undefined;
  let value: unknown = descriptor?.value;
  const slot: HookSlot = {
    owners: new Set([...(existing?.owners ?? []), new WeakRef(registry)]),
  };
  const setter = function (this: object, next: unknown): void {
    if (this !== owner) {
      Object.defineProperty(this, name, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return;
    }
    const oldValue = value;
    const oldWritten = written;
    value = next;
    written = true;
    const pending: (readonly [
      RegistryState,
      readonly (readonly [Registration, bigint])[],
    ])[] = [];
    try {
      for (const reference of slot.owners) {
        const state = reference.deref();
        if (state === undefined || state.disposed)
          slot.owners.delete(reference);
        else pending.push([state, state.prepare()]);
      }
    } catch (error) {
      value = oldValue;
      written = oldWritten;
      throw error;
    }
    for (const [state, records] of pending) state.apply(records);
  };
  setters.set(slot, setter);
  const getter = function (this: object): unknown {
    if (written) return value;
    const inherited: object | null = Object.getPrototypeOf(owner);
    return inherited === null ? undefined : Reflect.get(inherited, name, this);
  };
  getters.set(slot, getter);
  Object.defineProperty(owner, name, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    get: getter,
    set: setter,
  });
  if (methods === undefined) {
    methods = new Map();
    slots.set(owner, methods);
  }
  methods.set(name, slot);
}
const setters = new WeakMap<HookSlot, (this: object, value: unknown) => void>();
const getters = new WeakMap<HookSlot, (this: object) => unknown>();

interface WatchedMethod {
  readonly owner: object;
  readonly name: string;
  descriptor: PropertyDescriptor | undefined;
}

function sameDescriptor(
  a: PropertyDescriptor | undefined,
  b: PropertyDescriptor | undefined
): boolean {
  return (
    a?.get === b?.get &&
    a?.set === b?.set &&
    a?.value === b?.value &&
    a?.writable === b?.writable &&
    a?.configurable === b?.configurable &&
    a?.enumerable === b?.enumerable
  );
}

/** Metadata for one editor; the host consumes rows before opening each update. */
export class ForeignClassRegistry {
  private readonly state = new RegistryState();
  private readonly watched: WatchedMethod[] = [];
  private readonly prototypes = new Map<object, object | null>();
  private cachedRows: readonly NodeRegistration[] = [];
  private cachedRevision = -1;

  constructor(catalog: NativeNodeCatalog, classes: readonly NodeClass[]) {
    const byType = new Map<string, NodeClass>();
    const registered = new Map<NodeClass, string>();
    for (const klass of classes) {
      if (registered.has(klass)) continue;
      const baseline = catalog.nearest(klass);
      if (baseline.klass === klass && baseline.type === null)
        throw new TypeError('abstract native bases cannot be registered');
      const type = catalog.typeOf(klass) ?? typeName(klass);
      const previous = byType.get(type) ?? catalog.nativeType(type);
      if (previous !== undefined && previous !== klass)
        throw new TypeError(`duplicate node type ${type}`);
      byType.set(type, klass);
      registered.set(klass, type);
    }
    for (const [klass, type] of registered) {
      const baseline = catalog.nearest(klass);
      const ancestry: string[] = [];
      let current = parent(klass);
      while (current !== null) {
        const ancestor = registered.get(current) ?? catalog.typeOf(current);
        if (ancestor !== undefined) ancestry.push(ancestor);
        current = parent(current);
      }
      this.state.records.set(klass, {
        klass,
        type,
        kind: baseline.kind,
        ancestry: Object.freeze(ancestry),
        extends: ancestry[0] ?? null,
        native: baseline.klass,
        baseline,
        overrides: 0n,
      });
    }
    this.state.refresh();
    // Walk ancestry once. Descriptor checks preserve defineProperty/spyOn and
    // user-accessor semantics without rewalking every class and hook per update.
    this.rebuildWatchlist();
  }

  private rebuildWatchlist(): void {
    this.watched.length = 0;
    this.prototypes.clear();
    const seen = new WeakMap<object, Set<string>>();
    for (const record of this.state.records.values()) {
      let klass: NodeClass | null = record.klass;
      while (klass !== null) {
        for (const hook of foreignHooks) {
          let owner: object | null = target(klass, hook.static);
          while (owner !== null) {
            let names = seen.get(owner);
            if (names === undefined) {
              names = new Set();
              seen.set(owner, names);
            }
            if (!names.has(hook.name)) {
              names.add(hook.name);
              if (owner !== Object.prototype && owner !== Function.prototype)
                watch(owner, hook.name, this.state);
              this.prototypes.set(owner, Object.getPrototypeOf(owner));
              this.watched.push({
                owner,
                name: hook.name,
                descriptor: Object.getOwnPropertyDescriptor(owner, hook.name),
              });
            }
            owner = Object.getPrototypeOf(owner);
          }
        }
        klass = parent(klass);
      }
    }
  }

  rows(): readonly NodeRegistration[] {
    this.assertLive();
    const changed: WatchedMethod[] = [];
    let changedChain = false;
    for (const [owner, prototype] of this.prototypes) {
      if (Object.getPrototypeOf(owner) !== prototype) {
        this.state.dirty = true;
        changedChain = true;
      }
    }
    for (const entry of this.watched) {
      const descriptor = Object.getOwnPropertyDescriptor(
        entry.owner,
        entry.name
      );
      if (!sameDescriptor(entry.descriptor, descriptor)) {
        this.state.dirty = true;
        changed.push(entry);
      }
      const slot = slots.get(entry.owner)?.get(entry.name);
      if (
        descriptor?.get !== undefined &&
        (slot === undefined || descriptor.get !== getters.get(slot))
      ) {
        // A user getter may change its returned method without a property write.
        this.state.dirty = true;
      }
    }
    this.state.refresh();
    if (changedChain) this.rebuildWatchlist();
    else
      for (const entry of changed) {
        if (
          entry.owner !== Object.prototype &&
          entry.owner !== Function.prototype
        )
          watch(entry.owner, entry.name, this.state);
        entry.descriptor = Object.getOwnPropertyDescriptor(
          entry.owner,
          entry.name
        );
      }
    if (this.cachedRevision !== this.state.revision) {
      this.cachedRows = Object.freeze(
        [...this.state.records.values()].map(({ baseline: _, ...record }) =>
          Object.freeze(record)
        )
      );
      this.cachedRevision = this.state.revision;
    }
    return this.cachedRows;
  }

  beforeUpdate(): readonly NodeRegistration[] {
    const rows = this.rows();
    this.state.started = true;
    return rows;
  }

  dispose(): void {
    this.state.disposed = true;
    this.state.records.clear();
    this.watched.length = 0;
    this.prototypes.clear();
    this.cachedRows = [];
  }

  private assertLive(): void {
    if (this.state.disposed) throw new Error('node registry is disposed');
  }
}
