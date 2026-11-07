import { isTestFrame } from './attribution';
import { Encoder } from './encode';
import { errorValue, fields, type Fields, type Fixture, type Op, type Value } from './schema';

const patched = new WeakSet<object>();

export const modules = new Map<string, Record<string, unknown>>();
export let current: Recorder | undefined;
export function activate(recorder?: Recorder): void { current = recorder; }

/** Wrap the test boundary only; upstream imports keep their original identity. */
export function wrapModule<T extends Record<string, unknown>>(module: T, name: string): T {
  modules.set(name, module);
  for (const value of Object.values(module)) {
    if (typeof value !== 'function' || !value.prototype || patched.has(value.prototype)) continue;
    patched.add(value.prototype);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value.prototype))) {
      if (key === 'constructor' || typeof descriptor.value !== 'function') continue;
      const original = descriptor.value;
      Object.defineProperty(value.prototype, key, { ...descriptor, value: function (this: unknown, ...args: unknown[]) {
        if (!current) return Reflect.apply(original, this, args);
        return current.invoke(`${value.name}.${key}`, original, this, args);
      } });
    }
  }
  return new Proxy(module, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      return new Proxy(value, {
        apply(fn, receiver, args) {
          if (!current) return Reflect.apply(fn, receiver, args);
          current.encoder.functions.set(fn, `${name}.${key}`);
          return current.invoke(`${name}.${key}`, fn, undefined, args);
        },
        construct(fn, args, newTarget) {
          if (!current) return Reflect.construct(fn, args, newTarget);
          return current.wrap(Reflect.construct(fn, args, newTarget));
        },
      });
    },
  });
}

export class Recorder {
  readonly encoder = new Encoder();
  readonly trace: Op[] = [];
  readonly tapes: Fixture['tapes'] = [];
  readonly editors = new Map<object, number>();
  readonly reasons = new Set<string>();
  private proxies = new WeakMap<object, object>();
  private raw = new WeakMap<object, object>();
  private calls = this.trace;
  private depth = 0;
  private updateId = 0;
  private parent?: number;
  private callbackKind?: string;
  private commits = new Map<object, number>();
  private pending = new Map<object, number[]>();
  private causes = new Map<object, Set<string>>();

  private encode(value: unknown): Value {
    try { return this.encoder.encode(this.unwrap(value)); }
    catch (error) { this.reasons.add(errorValue(error).message); return { $undef: true }; }
  }

  unwrap(value: unknown): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    const raw = this.raw.get(value);
    if (raw) return raw;
    if (Array.isArray(value)) return value.map((item) => this.unwrap(item));
    return value;
  }

  wrap<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    const object = value as object;
    const known = this.proxies.get(object);
    if (known) return known as T;
    const proxy = new Proxy(object, {
      get: (target, key) => {
        const item = Reflect.get(target, key, target);
        if (typeof key === 'symbol') {
          if (key === Symbol.iterator && typeof item === 'function') {
            return () => {
              const values = Array.from(Reflect.apply(item, target, []) as Iterable<unknown>);
              if (this.depth === 0 && isTestFrame()) {
                this.calls.push({ op: 'call', fn: 'iter', this: this.encode(target), args: [], ret: this.encode(values) });
              }
              return values.map((entry) => this.wrap(entry))[Symbol.iterator]();
            };
          }
          return item;
        }
        if (typeof item === 'function') {
          return (...args: unknown[]) => this.invoke(`${target.constructor.name}.${key}`, item, target, args);
        }
        if (this.depth === 0 && isTestFrame()) {
          if (/^(innerHTML|outerHTML)$/.test(key)) this.reasons.add('view:dom-assertion');
          this.calls.push({ op: 'call', fn: `get:${key}`, this: this.encode(target), args: [], ret: this.encode(item) });
        }
        return this.wrap(item);
      },
      set: (target, key, item) => {
        if (this.depth === 0 && isTestFrame()) this.reasons.add(`B-only:property-write:${String(key)}`);
        return Reflect.set(target, key, this.unwrap(item), target);
      },
    });
    this.proxies.set(object, proxy);
    this.raw.set(proxy, object);
    return proxy as T;
  }

  private scoped<T>(calls: Op[], kind: string, run: () => T): T {
    const previous = { calls: this.calls, depth: this.depth, kind: this.callbackKind };
    this.calls = calls;
    this.depth = 0;
    this.callbackKind = kind;
    try { return run(); }
    finally { this.calls = previous.calls; this.depth = previous.depth; this.callbackKind = previous.kind; }
  }

  invoke(name: string, fn: Function, receiver: unknown, args: unknown[]): unknown {
    const attributed = this.depth === 0 && isTestFrame();
    if (!attributed) return Reflect.apply(fn, this.unwrap(receiver), args.map((arg) => this.unwrap(arg)));
    if (/dispatchEvent|generateNodesFromDOM|applyDOMRange/.test(name)) this.reasons.add('B-only:dom-driver');
    if (/createDOM|exportDOM|getElementByKey|getRootElement/.test(name)) this.reasons.add('view:dom-api');
    if (/register(Update|Mutation|TextContent)Listener/.test(name)) this.reasons.add('B-only:listener');
    if (this.callbackKind === 'tape' && /getWritable|\.set|\.append|\.remove|\.insert|\$set/.test(name)) {
      this.reasons.add('A-hand:mutating-callback');
    }
    if (name.endsWith('.createEditor') || name.endsWith('.createHeadlessEditor')) {
      this.depth++;
      try {
        const editor = Reflect.apply(fn, receiver, args);
        this.editor(editor, fields(args[0] ?? {}));
        return this.wrap(editor);
      } finally { this.depth--; }
    }
    const rawReceiver = this.unwrap(receiver);
    if (/\.(update|read)$/.test(name) && typeof args[0] === 'function') {
      const kind = name.endsWith('.update') ? 'update' : 'read';
      const object = fields(rawReceiver);
      const editor = '_editorState' in object ? object : undefined;
      if (!editor && !('_nodeMap' in object)) this.reasons.add('unsupported-read-receiver');
      const id = this.updateId++;
      const calls: Op[] = [];
      const op: Op = { op: kind, editor: editor ? this.editor(editor) : 0, calls };
      if (!editor) op.state = this.encode(object);
      if (kind === 'update') {
        op.id = id;
        op.cause = 'test';
        op.opts = this.encode(args[1] ?? {});
        if (this.parent !== undefined) op.parent = this.parent;
        if (editor) this.pending.set(editor, [...this.pending.get(editor) ?? [], id]);
      }
      this.calls.push(op);
      const callback = args[0];
      const previousParent = this.parent;
      const wrapped = () => this.scoped(calls, kind, () => {
        if (kind === 'update') this.parent = id;
        try { return Reflect.apply(callback, undefined, []); }
        finally { this.parent = previousParent; }
      });
      this.depth++;
      try { return Reflect.apply(fn, rawReceiver, [wrapped, ...args.slice(1)]); }
      catch (error) { op.error = errorValue(error); throw error; }
      finally { this.depth--; }
    }
    const op: Op = { op: 'call', fn: name, args: [] };
    if (rawReceiver && typeof rawReceiver === 'object') op.this = this.encode(rawReceiver);
    const wrappedArgs = args.map((arg) => {
      const raw = this.unwrap(arg);
      if (typeof raw !== 'function') return raw;
      const exported = this.encoder.functions.get(raw);
      if (exported) return raw;
      const tape = this.tapes.length;
      this.tapes.push({ invocations: [] });
      const wrapped = (...values: unknown[]) => {
        const invocation = { args: values.map((v) => this.encode(v)), calls: [] as Op[], ret: undefined as Value | undefined };
        this.tapes[tape].invocations.push(invocation);
        return this.scoped(invocation.calls, 'tape', () => {
          const result = Reflect.apply(raw, undefined, values.map((v) => this.wrap(v)));
          invocation.ret = this.encode(result);
          return this.unwrap(result);
        });
      };
      this.encoder.functions.set(wrapped, `tape:${tape}`);
      return wrapped;
    });
    op.args = wrappedArgs.map((arg) => {
      const exported = typeof arg === 'function' ? this.encoder.functions.get(arg) : undefined;
      return exported?.startsWith('tape:') ? { $tape: Number(exported.slice(5)) } : this.encode(arg);
    });
    this.calls.push(op);
    this.depth++;
    try {
      const result = Reflect.apply(fn, rawReceiver, wrappedArgs);
      op.ret = this.encode(result);
      return this.wrap(result);
    } catch (error) { op.throws = errorValue(error); throw error; }
    finally { this.depth--; }
  }

  editor(editor: object, config?: Record<string, unknown>): number {
    const known = this.editors.get(editor);
    if (known !== undefined) return known;
    const id = this.editors.size;
    this.editors.set(editor, id);
    const raw = fields(editor);
    const actual = fields(raw._config);
    const nodes = config?.nodes ?? [];
    const encodedNodes: Value[] = [];
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (typeof node === 'function' && 'getType' in node && typeof node.getType === 'function') {
          encodedNodes.push(node.getType());
        } else this.reasons.add('B-only:node-replacement');
      }
    }
    this.trace.push({ op: 'createEditor', id, config: {
      namespace: String(actual.namespace), nodes: encodedNodes, replacements: [], plugins: [],
      theme: this.encode(actual.theme ?? {}), editable: raw._editable !== false,
      rootElement: raw._rootElement !== null,
    }, ret: this.encode(editor) });
    return id;
  }

  begin(editor: object): void {
    this.editor(editor);
    const cause = this.parent === undefined ? 'listener-enqueued' : 'test';
    const causes = this.causes.get(editor) ?? new Set();
    causes.add(cause);
    this.causes.set(editor, causes);
    this.encoder.version = (this.commits.get(editor) ?? 0) + 1;
  }

  commit(editor: object, tags: Set<string>, dirtyLeaves: Set<string>, dirtyElements: Map<string, boolean>, normalized: Set<string>): void {
    const index = (this.commits.get(editor) ?? 0) + 1;
    this.commits.set(editor, index);
    this.encoder.version = index;
    this.trace.push({ op: 'commit', editor: this.editor(editor), index,
      updates: this.pending.get(editor) ?? [], causes: [...this.causes.get(editor) ?? []],
      snapshot: { ...this.snapshot(editor), tags: [...tags], dirty: {
        leaves: [...dirtyLeaves], elements: [...dirtyElements],
      }, normalized: [...normalized] },
    });
    this.pending.delete(editor);
    this.causes.delete(editor);
  }

  snapshot(editor: object): Fields {
    this.depth++;
    try { return snapshot(editor); } finally { this.depth--; }
  }

  error(editor: object, error: unknown, during: string): void {
    this.trace.push({ op: 'error', editor: this.editor(editor), during, ...errorValue(error) });
  }
}

/** Snapshot raw state without observable listener registration or membrane reads. */
export function snapshot(editor: object): Fields {
  const state = fields(fields(editor)._editorState);
  const map = state._nodeMap;
  if (!(map instanceof Map) || typeof state.toJSON !== 'function' || typeof state.read !== 'function') {
    throw new Error('Invalid editor state');
  }
  const path = (key: string): number[] => {
    const node = map.get(key);
    if (!node || key === 'root') return [];
    const parent = map.get(node.__parent);
    if (!parent) return [];
    const children = parent.getChildrenKeys();
    return [...path(parent.__key), children.indexOf(key)];
  };
  return Reflect.apply(state.read, state, [() => {
    const selection = state._selection ? fields(state._selection) : null;
    let serialized: Value = null;
    if (selection?.anchor && selection?.focus) {
      const point = (value: unknown): Fields => {
        const p = fields(value);
        return { key: String(p.key), path: path(String(p.key)), offset: Number(p.offset), type: String(p.type) };
      };
      serialized = { type: 'range', anchor: point(selection.anchor), focus: point(selection.focus),
        format: Number(selection.format), style: String(selection.style), isBackward: Reflect.apply(selection.isBackward as Function, selection, []) };
    } else if (selection?._nodes) {
      serialized = { type: 'node', keys: [...selection._nodes as Set<string>], paths: [...selection._nodes as Set<string>].map(path) };
    }
    return { json: Reflect.apply(state.toJSON as Function, state, []), selection: serialized, text: map.get('root').getTextContent(), nodeMapKeys: [...map.keys()] };
  }]);
}

// Installed in both record and replay environments; the pinned source contains optional hooks only.
Object.assign(globalThis, { __lexRec: {
  begin: (editor: object) => current?.begin(editor),
  commit: (editor: object, tags: Set<string>, leaves: Set<string>, elements: Map<string, boolean>, normalized: Set<string>) => current?.commit(editor, tags, leaves, elements, normalized),
  error: (editor: object, error: unknown, during: string) => current?.error(editor, error, during),
} });
