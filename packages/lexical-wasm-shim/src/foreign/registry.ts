import { foreignHookIndex } from '../backend/conformance';
import { foreignHooks } from '../hooks.generated';

export type NodeKind = 'Element' | 'Text' | 'Decorator' | 'LineBreak' | 'Root';
export type NodeClass = Function & { readonly prototype: object };
export interface NativeNodeClass {
  readonly klass: NodeClass;
  readonly kind: NodeKind;
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
  readonly type: string;
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
    const names = foreignHookIndex();
    if (names.some((name, i) => name !== foreignHooks[i]?.name))
      throw new Error('foreign hook index mismatch');
    for (const { klass, kind } of classes) {
      if (this.entries.has(klass))
        throw new TypeError('duplicate native node class');
      const type = typeName(klass);
      if (this.types.has(type))
        throw new TypeError(`duplicate native node type ${type}`);
      this.types.set(type, klass);
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
    return this.entries.get(klass)?.type;
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
    for (const [record, mask] of this.prepare()) record.overrides = mask;
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
  if (existing !== undefined && descriptor?.set === setters.get(existing)) {
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
    const pending: (readonly (readonly [Registration, bigint])[])[] = [];
    try {
      for (const reference of slot.owners) {
        const state = reference.deref();
        if (state === undefined || state.disposed)
          slot.owners.delete(reference);
        else pending.push(state.prepare());
      }
    } catch (error) {
      value = oldValue;
      written = oldWritten;
      throw error;
    }
    for (const records of pending) {
      for (const [record, mask] of records) record.overrides = mask;
    }
  };
  setters.set(slot, setter);
  Object.defineProperty(owner, name, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    get(this: object): unknown {
      if (written) return value;
      const inherited: object | null = Object.getPrototypeOf(owner);
      return inherited === null
        ? undefined
        : Reflect.get(inherited, name, this);
    },
    set: setter,
  });
  if (methods === undefined) {
    methods = new Map();
    slots.set(owner, methods);
  }
  methods.set(name, slot);
}
const setters = new WeakMap<HookSlot, (this: object, value: unknown) => void>();

/** Metadata for one editor; the host consumes rows before opening each update. */
export class ForeignClassRegistry {
  private readonly state = new RegistryState();

  constructor(catalog: NativeNodeCatalog, classes: readonly NodeClass[]) {
    const byType = new Map<string, NodeClass>();
    const registered = new Map<NodeClass, string>();
    for (const klass of classes) {
      if (registered.has(klass)) continue;
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
    this.watch();
  }

  rows(): readonly NodeRegistration[] {
    this.assertLive();
    this.state.refresh();
    return Object.freeze(
      [...this.state.records.values()].map(({ baseline: _, ...record }) =>
        Object.freeze(record)
      )
    );
  }

  beforeUpdate(): readonly NodeRegistration[] {
    const rows = this.rows();
    // Reinstall data-slot traps that spyOn/defineProperty replaced. The original
    // native implementation remains in the catalog, never the patched prototype.
    this.watch();
    this.state.started = true;
    return rows;
  }

  dispose(): void {
    this.state.disposed = true;
    this.state.records.clear();
  }

  private assertLive(): void {
    if (this.state.disposed) throw new Error('node registry is disposed');
  }

  private watch(): void {
    for (const record of this.state.records.values()) {
      let klass: NodeClass | null = record.klass;
      while (klass !== null) {
        for (const hook of foreignHooks)
          watch(target(klass, hook.static), hook.name, this.state);
        klass = parent(klass);
      }
    }
  }
}
