import { isTestFrame } from './attribution';
import {
  Encoder,
  namedCommands,
  namedFunctions,
  namedTransformers,
} from './encode';
import { preorderKeys } from './initial';
import {
  errorValue,
  type Fields,
  type Fixture,
  fields,
  type Invocation,
  type Op,
  type Value,
} from './schema';
import { instrumentTransformers } from './transformers';

const patched = new WeakSet<object>();
const wrappedFunctions = new WeakMap<Function, Function>();

export const modules = new Map<string, Record<string, unknown>>();
export let current: Recorder | undefined;
export function activate(recorder?: Recorder): void {
  current = recorder;
}

/** Separate model setup from the original test's DOM assertions. */
export function testBody<T extends Function>(body: T): T {
  return new Proxy(body, {
    apply(fn, receiver, args) {
      const recorder = current;
      if (!recorder) return Reflect.apply(fn, receiver, args);
      recorder.inTestBody = true;
      const finish = () => {
        recorder.inTestBody = false;
      };
      try {
        const result = Reflect.apply(fn, receiver, args);
        if (result && typeof result.then === 'function')
          return Promise.resolve(result).finally(finish);
        finish();
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    },
  });
}

export function modelDOM<T>(value: T): T {
  if (
    current?.inTestBody &&
    value &&
    typeof value === 'object' &&
    'nodeType' in value &&
    'nodeName' in value
  )
    current.reasons.add('view:dom-assertion');
  return value;
}

function registerValues(value: unknown, name: string, seen: Set<object>): void {
  if (
    !value ||
    (typeof value !== 'function' && typeof value !== 'object') ||
    seen.has(value)
  )
    return;
  seen.add(value);
  if (typeof value === 'function') {
    namedFunctions.set(value, name);
    return;
  }
  if (
    'type' in value &&
    ('regExp' in value || 'regExpStart' in value || 'tag' in value)
  )
    namedTransformers.set(value, name);
  if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)
    for (const [key, item] of Object.entries(value))
      registerValues(item, `${name}.${key}`, seen);
}

/** Wrap the test boundary only; upstream imports keep their original identity. */
export function wrapModule<T extends Record<string, unknown>>(
  module: T,
  name: string
): T {
  modules.set(name, module);
  for (const [key, value] of Object.entries(module))
    registerValues(value, `${name}.${key}`, new Set());
  instrumentTransformers(module, name, () => current);
  for (const [key, value] of Object.entries(module)) {
    if (key.endsWith('_COMMAND') && value && typeof value === 'object')
      namedCommands.set(value, key);
    if (
      value &&
      typeof value === 'object' &&
      ('regExp' in value || 'regExpStart' in value)
    )
      namedTransformers.set(value, `${name}.${key}`);
    if (typeof value === 'function')
      namedFunctions.set(value, `${name}.${key}`);
    if (
      typeof value !== 'function' ||
      !value.prototype ||
      patched.has(value.prototype)
    )
      continue;
    patched.add(value.prototype);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value.prototype)
    )) {
      if (key === 'constructor' || typeof descriptor.value !== 'function')
        continue;
      const original = descriptor.value;
      Object.defineProperty(value.prototype, key, {
        ...descriptor,
        value: function (this: unknown, ...args: unknown[]) {
          if (!current) return Reflect.apply(original, this, args);
          return current.invoke(`${value.name}.${key}`, original, this, args);
        },
      });
    }
  }
  return new Proxy(module, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function' || typeof key !== 'string') return value;
      if (/^class\s/.test(Function.prototype.toString.call(value)))
        return value;
      if (
        name.includes('/__tests__/') &&
        !key.startsWith('$') &&
        !('getType' in value)
      )
        return value;
      const known = wrappedFunctions.get(value);
      if (known) return known;
      const wrapped = new Proxy(value, {
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
      namedFunctions.set(wrapped, `${name}.${key}`);
      wrappedFunctions.set(value, wrapped);
      return wrapped;
    },
  });
}

export class Recorder {
  constructor(readonly modelProjection = false) {}
  projectingView = false;
  inTestBody = false;
  readonly encoder = new Encoder();
  readonly trace: Op[] = [];
  readonly tapes: Fixture['tapes'] = [];
  readonly editors = new Map<object, number>();
  readonly creationConfigs = new WeakMap<object, Record<string, unknown>>();
  readonly reasons = new Set<string>();
  readonly transformersFired = new Set<string>();
  initial: Fixture['initial'] = { editorState: null, selection: null };
  private partialRequested = false;
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
  private awaitingTest = new WeakSet<object>();
  private implementationEditors = new WeakSet<object>();
  private cause?: string;

  enter(cause?: string): () => void {
    const depth = this.depth;
    const previous = this.cause;
    this.depth++;
    if (
      cause &&
      !['commit', 'microtask'].includes(cause) &&
      previous !== 'history'
    )
      this.cause = cause;
    return () => {
      this.depth = depth;
      this.cause = previous;
    };
  }

  private encode(value: unknown): Value {
    try {
      return this.encoder.encode(this.unwrap(value));
    } catch (error) {
      this.reasons.add(errorValue(error).message);
      return { $undef: true };
    }
  }

  unwrap(value: unknown): unknown {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function')
    )
      return value;
    const raw = this.raw.get(value);
    if (raw) return raw;
    if (Array.isArray(value)) return value.map((item) => this.unwrap(item));
    return value;
  }

  wrap<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    const object = value as object;
    if (this.raw.has(object)) return value;
    const known = this.proxies.get(object);
    if (known) return known as T;
    // A shadow target permits lazy wrapping of frozen selection fields without
    // violating Proxy's non-configurable-property invariants.
    const shadow = Array.isArray(object)
      ? []
      : Object.create(Object.getPrototypeOf(object));
    const proxy = new Proxy(shadow, {
      ownKeys: () => Reflect.ownKeys(object),
      has: (_target, key) => Reflect.has(object, key),
      getOwnPropertyDescriptor: (_target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (!descriptor) return undefined;
        return {
          ...descriptor,
          ...(Array.isArray(object) && key === 'length'
            ? { writable: true }
            : {}),
          configurable: !(Array.isArray(object) && key === 'length'),
        };
      },
      get: (_target, key) => {
        const target = object;
        const item = Reflect.get(target, key, target);
        if (key === 'constructor') return item;
        if (typeof key === 'symbol') {
          if (key === Symbol.iterator && typeof item === 'function') {
            return () => {
              const values = Array.from(
                Reflect.apply(item, target, []) as Iterable<unknown>
              );
              if (this.depth === 0 && isTestFrame()) {
                this.calls.push({
                  op: 'call',
                  fn: 'iter',
                  this: this.encode(target),
                  args: [],
                  ret: this.encode(values),
                });
              }
              return values.map((entry) => this.wrap(entry))[Symbol.iterator]();
            };
          }
          return item;
        }
        if (Array.isArray(target) && typeof item === 'function') {
          return (...args: unknown[]) => Reflect.apply(item, proxy, args);
        }
        if (typeof item === 'function') {
          return (...args: unknown[]) =>
            this.invoke(
              `${target.constructor.name}.${key}`,
              item,
              target,
              args
            );
        }
        if (this.depth === 0 && isTestFrame()) {
          if (/^(innerHTML|outerHTML)$/.test(key))
            this.reasons.add('view:dom-assertion');
          this.calls.push({
            op: 'call',
            fn: `get:${key}`,
            this: this.encode(target),
            args: [],
            ret: this.encode(item),
          });
        }
        return this.wrap(item);
      },
      set: (_target, key, item) => {
        const target = object;
        if (this.depth === 0 && isTestFrame())
          this.reasons.add(
            this.callbackKind === 'tape'
              ? 'A-hand:mutating-callback'
              : `B-only:property-write:${String(key)}`
          );
        return Reflect.set(target, key, this.unwrap(item), target);
      },
    });
    this.proxies.set(object, proxy);
    this.raw.set(proxy, object);
    return proxy as T;
  }

  private scoped<T>(calls: Op[], kind: string, run: () => T): T {
    const previous = {
      calls: this.calls,
      depth: this.depth,
      kind: this.callbackKind,
    };
    this.calls = calls;
    this.depth = 0;
    this.callbackKind = kind;
    try {
      return run();
    } finally {
      this.calls = previous.calls;
      this.depth = previous.depth;
      this.callbackKind = previous.kind;
    }
  }

  invoke(
    name: string,
    fn: Function,
    receiver: unknown,
    args: unknown[]
  ): unknown {
    // Helpers entered below the membrane still cannot mutate a taped callback's model.
    if (
      this.callbackKind === 'tape' &&
      /getWritable|\.(set|append|remove|insert|clear|toggle|split|merge|replace|splice|delete|select|deselect|markDirty|update|dispatchCommand|format|extract|focus|blur|reset|add|modify|forwardDeletion|collapseAtStart|afterCloneFrom|createParentElementNode|register)|\$(create|set|insert|remove|delete|split|merge|toggle|apply|patch|copy|normalize|add|mark|ensure|move|update|trim|wrap|unwrap|restore|convertFrom|generateNodesFrom)/.test(
        name
      )
    )
      this.reasons.add('A-hand:mutating-callback');
    const attributed = this.depth === 0 && isTestFrame();
    if (!attributed)
      return Reflect.apply(
        fn,
        this.unwrap(receiver),
        args.map((arg) => this.unwrap(arg))
      );
    if (this.modelProjection && name.endsWith('.$generateNodesFromDOM'))
      this.partialRequested = true;
    if (
      this.modelProjection &&
      name === '@lexical/html.$generateHtmlFromNodes'
    ) {
      this.projectingView = true;
      this.depth++;
      try {
        return Reflect.apply(
          fn,
          this.unwrap(receiver),
          args.map((arg) => this.unwrap(arg))
        );
      } finally {
        this.depth--;
        this.projectingView = false;
      }
    }
    if (/dispatchEvent|generateNodesFromDOM|applyDOMRange/.test(name))
      this.reasons.add('B-only:dom-driver');
    if (/createDOM|exportDOM|getElementByKey|getRootElement/.test(name))
      this.reasons.add('view:dom-api');
    if (/register(Update|Mutation|TextContent)Listener/.test(name))
      this.reasons.add('B-only:listener');
    if (
      name.endsWith('.createEditor') ||
      name.endsWith('.createHeadlessEditor')
    ) {
      this.depth++;
      try {
        const editor = Reflect.apply(fn, receiver, args);
        this.editor(editor, fields(args[0] ?? {}));
        return this.wrap(editor);
      } finally {
        this.depth--;
      }
    }
    const rawReceiver = this.unwrap(receiver);
    if (
      name.endsWith('.setRootElement') &&
      (/__tests__\/utils/.test(new Error().stack ?? '') ||
        (!this.inTestBody &&
          (args[0] === null ||
            (args[0] &&
              typeof args[0] === 'object' &&
              fields(args[0]).nodeName === 'DIV' &&
              fields(args[0]).childNodes &&
              fields(fields(args[0]).childNodes).length === 0))))
    ) {
      const object = fields(rawReceiver);
      this.editor(object);
      const create = this.trace.find(
        (op) => op.op === 'createEditor' && op.id === this.editors.get(object)
      );
      if (create && args[0] !== null) fields(create.config).rootElement = true;
      this.depth++;
      try {
        return Reflect.apply(fn, object, args);
      } finally {
        this.depth--;
      }
    }
    if (/\.(update|read)$/.test(name) && typeof args[0] === 'function') {
      const kind = name.endsWith('.update') ? 'update' : 'read';
      if (kind === 'read' && this.partialRequested) this.startPartial();
      const object = fields(rawReceiver);
      const editor = '_editorState' in object ? object : undefined;
      if (!editor && !('_nodeMap' in object))
        this.reasons.add('unsupported-read-receiver');
      const id = kind === 'update' ? this.updateId++ : this.updateId;
      const calls: Op[] = [];
      const options =
        args[1] === undefined ? undefined : this.argument(args[1]);
      const op: Op = {
        op: kind,
        editor: editor ? this.editor(editor) : 0,
        calls,
      };
      if (!editor) op.state = this.encode(object);
      if (kind === 'read' && args[1] !== undefined)
        op.opts = this.encode(options);
      if (kind === 'update') {
        op.id = id;
        op.cause = 'test';
        op.opts = this.encode(options ?? {});
        if (this.parent !== undefined) op.parent = this.parent;
        if (editor) {
          this.pending.set(editor, [...(this.pending.get(editor) ?? []), id]);
          this.awaitingTest.add(editor);
        }
      }
      this.calls.push(op);
      const callback = args[0];
      const previousParent = this.parent;
      const wrapped = () =>
        this.scoped(calls, kind, () => {
          if (editor) this.awaitingTest.delete(editor);
          if (kind === 'update') this.parent = id;
          try {
            return Reflect.apply(callback, undefined, []);
          } finally {
            this.parent = previousParent;
          }
        });
      this.depth++;
      try {
        return Reflect.apply(fn, rawReceiver, [
          wrapped,
          options,
          ...args.slice(2),
        ]);
      } catch (error) {
        op.error = errorValue(error);
        throw error;
      } finally {
        this.depth--;
      }
    }
    if (
      /\.register(MarkdownShortcuts|History|RichText|PlainText|List)$/.test(
        name
      )
    ) {
      const op: Op = {
        op: 'plugin',
        name,
        args: args.map((arg) => this.encode(arg)),
      };
      this.calls.push(op);
      this.depth++;
      try {
        const cleanup = Reflect.apply(
          fn,
          undefined,
          args.map((arg) => this.unwrap(arg))
        );
        return () => {
          this.reasons.add('B-only:plugin-disposal');
          return cleanup();
        };
      } finally {
        this.depth--;
      }
    }
    const op: Op = { op: 'call', fn: name, args: [] };
    if (rawReceiver && typeof rawReceiver === 'object')
      op.this = this.encode(rawReceiver);
    const wrappedArgs = args.map((arg) => this.argument(arg));
    op.args = wrappedArgs.map((arg) => this.encode(arg));
    this.calls.push(op);
    this.depth++;
    try {
      const result = Reflect.apply(fn, rawReceiver, wrappedArgs);
      op.ret = this.encode(result);
      return this.wrap(result);
    } catch (error) {
      op.throws = errorValue(error);
      throw error;
    } finally {
      this.depth--;
    }
  }

  private argument(value: unknown): unknown {
    const raw = this.unwrap(value);
    if (typeof raw === 'function') {
      if (this.encoder.functions.has(raw) || 'getType' in raw) return raw;
      const tape = this.tapes.length;
      this.tapes.push({ invocations: [] });
      const wrapped = (...values: unknown[]) => {
        const invocation: Invocation = {
          args: values.map((v) => this.encode(v)),
          calls: [] as Op[],
          ret: undefined as Value | undefined,
        };
        this.tapes[tape].invocations.push(invocation);
        return this.scoped(invocation.calls, 'tape', () => {
          try {
            const result = Reflect.apply(
              raw,
              undefined,
              values.map((v) => this.wrap(v))
            );
            invocation.ret = this.encode(result);
            return this.unwrap(result);
          } catch (error) {
            invocation.throws = errorValue(error);
            throw error;
          }
        });
      };
      this.encoder.functions.set(wrapped, `tape:${tape}`);
      return wrapped;
    }
    if (!raw || typeof raw !== 'object' || namedTransformers.has(raw))
      return raw;
    if (Array.isArray(raw)) {
      const items = raw.map((item) => this.argument(item));
      return items.every((item, i) => item === raw[i]) ? raw : items;
    }
    if (
      Object.getPrototypeOf(raw) === Object.prototype ||
      Object.getPrototypeOf(raw) === null
    ) {
      const entries = Object.entries(raw).map(
        ([key, item]) => [key, this.argument(item)] as const
      );
      return entries.every(([key, item]) => item === Reflect.get(raw, key))
        ? raw
        : Object.fromEntries(entries);
    }
    return raw;
  }

  private startPartial(): void {
    this.partialRequested = false;
    const editor = [...this.editors.keys()].at(-1);
    const createIndex = this.trace.findIndex((op) => op.op === 'createEditor');
    if (!editor || createIndex < 0 || this.editors.size !== 1) {
      this.reasons.add('partial:unsupported-editor-layout');
      return;
    }
    const state = fields(editor)._editorState;
    const raw = snapshot(editor);
    const getCounter = modules.get(
      'lexical/LexicalUtils'
    )?.getRecorderKeyCounter;
    if (typeof getCounter !== 'function')
      throw new Error('Missing initial key counter');
    this.initial = {
      editorState: raw.json,
      selection: raw.selection,
      keys: preorderKeys(fields(state)),
      nodeMapKeys: raw.nodeMapKeys as string[],
      nextKey: getCounter(),
    };
    this.encoder.reset();
    const prefix = this.trace.slice(0, createIndex + 1);
    prefix[createIndex].ret = this.encode(editor);
    this.trace.splice(0, this.trace.length, ...prefix);
    this.calls = this.trace;
    this.commits.clear();
    this.pending.clear();
    this.causes.clear();
    this.updateId = 0;
    this.tapes.length = 0;
    for (const reason of this.reasons)
      if (!/test-defined-model-class|node-replacement/.test(reason))
        this.reasons.delete(reason);
    this.trace.push({
      op: 'call',
      fn: 'LexicalEditor.getEditorState',
      this: this.encode(editor),
      args: [],
      ret: this.encode(state),
    });
  }

  editor(editor: object, config?: Record<string, unknown>): number {
    const known = this.editors.get(editor);
    if (known !== undefined) return known;
    const id = this.editors.size;
    this.editors.set(editor, id);
    const raw = fields(editor);
    config = this.creationConfigs.get(editor) ?? config;
    const actual = fields(raw._config);
    const registry = raw._nodes;
    const nodes =
      config?.nodes ??
      (registry instanceof Map
        ? [...registry.values()].map((entry) => entry.klass)
        : []);
    const encodedNodes: Value[] = [];
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        if (
          typeof node === 'function' &&
          'getType' in node &&
          typeof node.getType === 'function'
        ) {
          const symbol = namedFunctions.get(node);
          const known =
            symbol &&
            !symbol.includes('/__tests__/') &&
            !symbol.includes('/tests/');
          const defaults = [
            'TestElementNode',
            'TestTextNode',
            'TestInlineElementNode',
            'TestShadowRootNode',
            'TestSegmentedNode',
            'TestExcludeFromCopyElementNode',
            'TestDecoratorNode',
          ];
          if (!known && !defaults.includes(node.name))
            this.reasons.add('A-hand:test-defined-model-class');
          encodedNodes.push(node.getType());
        } else if (
          node &&
          typeof node === 'object' &&
          'replace' in node &&
          'with' in node
        ) {
          if (typeof node.with !== 'function' || !namedFunctions.has(node.with))
            this.reasons.add('A-hand:test-defined-node-replacement');
        } else this.reasons.add('B-only:node-replacement');
      }
    }
    this.trace.push({
      op: 'createEditor',
      id,
      config: {
        namespace: String(actual.namespace),
        namespaceGenerated: !config?.namespace,
        nodes: encodedNodes,
        replacements: Array.isArray(nodes)
          ? nodes
              .filter(
                (node) => node && typeof node === 'object' && 'replace' in node
              )
              .map((node) => this.encode(node))
          : [],
        plugins: [],
        theme: this.encode(actual.theme ?? {}),
        editable: raw._editable !== false,
        headless: raw._headless === true,
        rootElement: raw._rootElement !== null,
      },
      ret: this.encode(editor),
    });
    return id;
  }

  admitUpdate(editor: object, id: number): void {
    if (id !== this.updateId)
      throw new Error(`Unexpected update id ${id}; expected ${this.updateId}`);
    this.updateId++;
    this.pending.set(editor, [...(this.pending.get(editor) ?? []), id]);
    this.awaitingTest.add(editor);
  }

  begin(editor: object, options?: { discrete?: boolean }): void {
    if (!this.editors.has(editor) && this.depth > 0)
      this.implementationEditors.add(editor);
    if (this.implementationEditors.has(editor)) return;
    this.editor(editor);
    const cause = this.awaitingTest.has(editor)
      ? 'test'
      : (this.cause ?? (options?.discrete ? 'discrete' : 'listener-enqueued'));
    this.awaitingTest.delete(editor);
    if (cause !== 'test') {
      const id = this.updateId++;
      this.trace.push({
        op: 'update',
        id,
        editor: this.editor(editor),
        cause,
        opts: {},
        calls: [],
      });
      this.pending.set(editor, [...(this.pending.get(editor) ?? []), id]);
    }
    const causes = this.causes.get(editor) ?? new Set();
    causes.add(cause);
    this.causes.set(editor, causes);
    this.encoder.version = (this.commits.get(editor) ?? 0) + 1;
  }

  commit(
    editor: object,
    tags: Set<string>,
    dirtyLeaves: Set<string>,
    dirtyElements: Map<string, boolean>,
    normalized: Set<string>
  ): void {
    if (
      this.implementationEditors.has(editor) ||
      (!this.editors.has(editor) && this.depth > 0)
    )
      return;
    const index = (this.commits.get(editor) ?? 0) + 1;
    this.commits.set(editor, index);
    this.encoder.version = index;
    this.trace.push({
      op: 'commit',
      editor: this.editor(editor),
      index,
      updates: this.pending.get(editor) ?? [],
      causes: [
        ...(this.causes.get(editor) ?? (this.cause ? [this.cause] : [])),
      ],
      snapshot: {
        ...this.snapshot(editor),
        tags: [...tags],
        dirty: {
          leaves: [...dirtyLeaves].map(
            (key) => this.encoder.keys.get(key) ?? key
          ),
          elements: [...dirtyElements].map(([key, dirty]) => [
            this.encoder.keys.get(key) ?? key,
            dirty,
          ]),
        },
        normalized: [...normalized],
      },
    });
    this.pending.delete(editor);
    this.causes.delete(editor);
  }

  snapshot(editor: object): Fields {
    this.depth++;
    try {
      const result = snapshot(editor);
      if (
        result.selection &&
        typeof result.selection === 'object' &&
        !Array.isArray(result.selection)
      ) {
        const selection = result.selection;
        for (const field of ['anchor', 'focus']) {
          const point = selection[field];
          if (point && typeof point === 'object' && !Array.isArray(point))
            point.key = this.encoder.encode(point.key);
        }
        if (Array.isArray(selection.keys))
          selection.keys = selection.keys.map((key) =>
            this.encoder.encode(key)
          );
      }
      return result;
    } finally {
      this.depth--;
    }
  }

  error(editor: object, error: unknown, during: string): void {
    if (
      this.implementationEditors.has(editor) ||
      (!this.editors.has(editor) && this.depth > 0)
    )
      return;
    this.trace.push({
      op: 'error',
      editor: this.editor(editor),
      during,
      ...errorValue(error),
    });
  }
}

/** Snapshot raw state without observable listener registration or membrane reads. */
export function snapshot(editor: object): Fields {
  const state = fields(fields(editor)._editorState);
  const map = state._nodeMap;
  if (
    !(map instanceof Map) ||
    typeof state.toJSON !== 'function' ||
    typeof state.read !== 'function'
  ) {
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
  return Reflect.apply(state.read, state, [
    () => {
      const selection = state._selection ? fields(state._selection) : null;
      let serialized: Value = null;
      if (selection?.tableKey) {
        serialized = {
          type: 'table',
          tableKey: String(selection.tableKey),
          anchorCellKey: String(fields(selection.anchor).key),
          focusCellKey: String(fields(selection.focus).key),
        };
      } else if (selection?.anchor && selection?.focus) {
        const point = (value: unknown): Fields => {
          const p = fields(value);
          return {
            key: String(p.key),
            path: path(String(p.key)),
            offset: Number(p.offset),
            type: String(p.type),
          };
        };
        serialized = {
          type: 'range',
          anchor: point(selection.anchor),
          focus: point(selection.focus),
          format: Number(selection.format),
          style: String(selection.style),
          isBackward: Reflect.apply(
            selection.isBackward as Function,
            selection,
            []
          ),
        };
      } else if (selection?._nodes) {
        serialized = {
          type: 'node',
          keys: [...(selection._nodes as Set<string>)],
          paths: [...(selection._nodes as Set<string>)].map(path),
        };
      }
      return {
        json: Reflect.apply(state.toJSON as Function, state, []),
        selection: serialized,
        text: map.get('root').getTextContent(),
        nodeMapKeys: [...map.keys()],
      };
    },
  ]);
}

// Installed in both record and replay environments; the pinned source contains optional hooks only.
Object.assign(globalThis, {
  __lexRec: {
    enter: (cause: string) => current?.enter(cause),
    created: (editor: object, config?: Record<string, unknown>) =>
      current?.creationConfigs.set(editor, config ?? {}),
    begin: (editor: object, options?: { discrete?: boolean }) =>
      current?.begin(editor, options),
    commit: (
      editor: object,
      tags: Set<string>,
      leaves: Set<string>,
      elements: Map<string, boolean>,
      normalized: Set<string>
    ) => current?.commit(editor, tags, leaves, elements, normalized),
    tick: (reason = 'microtask') =>
      current?.trace.push({
        op: 'tick',
        n: current.trace.filter((op) => op.op === 'tick').length,
        reason,
      }),
    error: (editor: object, error: unknown, during: string) =>
      current?.error(editor, error, during),
  },
});
