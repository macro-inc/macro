import { isDeepStrictEqual } from 'node:util';
import { isOracleFrame } from './attribution';
import { Entropy } from './entropy';
import { captureEvents } from './events';
import { restoreInitial } from './initial';
import { activate, modules, Recorder, snapshot } from './membrane';
import {
  errorValue,
  type Fixture,
  fields,
  type Op,
  type Value,
} from './schema';

/** Locate mismatches without exposing fixture values in diagnostics. */
function difference(a: unknown, b: unknown, path = 'commit'): string {
  if (isDeepStrictEqual(a, b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (Object.hasOwn(a, key) !== Object.hasOwn(b, key))
        return `${path}.${key} (presence)`;
      const found = difference(
        fields(a)[key],
        fields(b)[key],
        `${path}.${key}`
      );
      if (found) return found;
    }
  }
  return path;
}

/** Replays fixture data only. No original test closure runs in this interpreter. */
export async function replay(
  fixture: Fixture,
  resetKeys: () => void
): Promise<void> {
  activate();
  if (
    fixture.schema !== 2 ||
    (!fixture.partial && fixture.initial.editorState !== null)
  )
    throw new Error('Unsupported fixture initialization');
  if (fixture.trace.some((op) => op.src === 'module-init'))
    throw new Error('B-only:module-init-entropy-requires-fresh-module-replay');
  resetKeys();
  const handles = new Map<string, unknown>();
  const versions = new WeakMap<object, number>();
  const editors = new Map<number, object>();
  const positions = fixture.tapes.map(() => 0);
  const commits: Op[] = [];
  const errors: Op[] = [];
  let errorMustThrow = false;
  let mismatch: Error | undefined;
  const cleanups: Function[] = [];
  const roots: HTMLElement[] = [];
  const logs: Op[] = [];
  const restoreEvents = captureEvents(
    (op) => logs.push(op),
    (reason) => {
      throw new Error(reason);
    }
  );
  const observer = new Recorder();
  const originalCommit = observer.commit.bind(observer);
  observer.commit = (...args) => {
    originalCommit(...args);
    if (observer.editors.has(args[0]))
      commits.push(observer.trace[observer.trace.length - 1]);
  };
  const originalError = observer.error.bind(observer);
  observer.error = (...args) => {
    originalError(...args);
    if (observer.editors.has(args[0]))
      errors.push(observer.trace[observer.trace.length - 1]);
  };
  const entropy = new Entropy(
    undefined,
    fixture.trace.filter(
      (op) =>
        (op.op === 'clock' || op.op === 'entropy') && op.src !== 'module-init'
    ),
    isOracleFrame
  );
  const lookup = (name: string): Function => {
    const dot = name.indexOf('.');
    let fn: unknown = modules.get(name.slice(0, dot));
    for (const part of name.slice(dot + 1).split('.')) fn = fields(fn)[part];
    if (typeof fn !== 'function') throw new Error(`Unknown API ${name}`);
    return fn;
  };
  const compare = (expected: Value, actual: unknown): void => {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      for (const tag of [
        '$h',
        '$ed',
        '$state',
        '$sel',
        '$pt',
        '$caret',
        '$iterator',
      ]) {
        if (tag in expected) {
          const key = `${tag}:${expected[tag]}`;
          if (handles.has(key)) {
            if (handles.get(key) !== actual)
              throw new Error(`Identity mismatch ${key}`);
          } else {
            if (actual === null || typeof actual !== 'object')
              throw new Error(`Missing object ${key}`);
            if (tag === '$h') {
              const object = fields(actual);
              if (object.__type !== expected.type)
                throw new Error(`Node type mismatch ${key}`);
              const version = versions.get(actual) ?? observer.encoder.version;
              if (version !== expected.ver)
                throw new Error(`Node version mismatch ${key}`);
              versions.set(actual, version);
            }
            handles.set(key, actual);
            if (
              tag === '$h' &&
              'key' in expected &&
              fields(actual).__key !== expected.key
            )
              throw new Error(`Node key mismatch ${key}`);
          }
          return;
        }
      }
      if (
        '$fn' in expected ||
        '$klass' in expected ||
        '$transformer' in expected ||
        '$cmd' in expected
      ) {
        if (decode(expected) !== actual)
          throw new Error('Named value mismatch');
        return;
      }
      if ('$key' in expected) {
        if (actual !== expected.raw) throw new Error('Key mismatch');
        return;
      }
      if ('$undef' in expected || '$num' in expected) {
        if (!Object.is(decode(expected), actual))
          throw new Error('Primitive mismatch');
        return;
      }
      if ('$map' in expected && actual instanceof Map) {
        compare(expected.$map, [...actual]);
        return;
      }
      if ('$set' in expected && actual instanceof Set) {
        compare(expected.$set, [...actual]);
        return;
      }
      const object = fields(actual);
      for (const [key, value] of Object.entries(expected))
        compare(value, object[key]);
      if (Object.keys(object).length !== Object.keys(expected).length)
        throw new Error('Object shape mismatch');
      return;
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length)
        throw new Error('Array mismatch');
      expected.forEach((value, index) => compare(value, actual[index]));
      return;
    }
    if (!Object.is(expected, actual))
      throw new Error(
        `Value mismatch: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`
      );
  };
  const decode = (value: Value): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(decode);
    for (const tag of [
      '$h',
      '$ed',
      '$state',
      '$sel',
      '$pt',
      '$caret',
      '$iterator',
    ]) {
      if (tag in value) {
        const key = `${tag}:${value[tag]}`;
        if (!handles.has(key)) throw new Error(`Unknown handle ${key}`);
        return handles.get(key);
      }
    }
    if ('$key' in value) return value.raw;
    if ('$undef' in value) return undefined;
    if ('$num' in value) return Number(value.$num);
    if ('$regexp' in value) {
      const regexp = new RegExp(String(value.$regexp), String(value.flags));
      regexp.lastIndex = Number(value.lastIndex);
      return regexp;
    }
    if ('$event' in value) {
      if (value.$event !== 'keydown' || value.key !== 'Tab')
        throw new Error('Unsupported model event');
      return new KeyboardEvent('keydown', {
        key: 'Tab',
        cancelable: true,
        shiftKey: Boolean(value.shiftKey),
        altKey: Boolean(value.altKey),
        ctrlKey: Boolean(value.ctrlKey),
        metaKey: Boolean(value.metaKey),
      });
    }
    if ('$fn' in value) return lookup(String(value.$fn));
    if ('$cmd' in value) {
      for (const module of modules.values())
        if (typeof value.$cmd === 'string' && value.$cmd in module)
          return module[value.$cmd];
      throw new Error(`Unknown command ${value.$cmd}`);
    }
    if ('$transformer' in value) {
      const name = String(value.$transformer);
      const dot = name.indexOf('.');
      let result: unknown = modules.get(name.slice(0, dot));
      for (const part of name.slice(dot + 1).split('.'))
        result = fields(result)[part];
      if (!result) throw new Error(`Unknown transformer ${name}`);
      return result;
    }
    if ('$klass' in value) {
      for (const module of modules.values()) {
        for (const item of Object.values(module).flatMap((value) =>
          Array.isArray(value) ? value : [value]
        )) {
          if (
            typeof item !== 'function' ||
            !('getType' in item) ||
            typeof item.getType !== 'function' ||
            item.name === 'LexicalNode'
          )
            continue;
          const config = modules.get('lexical')?.getStaticNodeConfig;
          if (typeof config !== 'function')
            throw new Error('Missing node config API');
          const ownType = Reflect.apply(config, undefined, [item]).ownNodeType;
          if (ownType === value.$klass) return item;
          if (Object.hasOwn(item, 'getType') && item.getType() === value.$klass)
            return item;
        }
      }
      throw new Error(`Unknown class ${value.$klass}`);
    }
    if ('$tape' in value) {
      const n = Number(value.$tape);
      return (...args: unknown[]) => {
        const invocation = fixture.tapes[n].invocations[positions[n]++];
        if (!invocation) throw new Error(`Extra tape invocation ${n}`);
        compare(invocation.args, args);
        execute(invocation.calls);
        if (invocation.throws) {
          const error = new Error(String(invocation.throws.message));
          error.name = String(invocation.throws.name);
          throw error;
        }
        return decode(
          invocation.ret === undefined ? { $undef: true } : invocation.ret
        );
      };
    }
    if ('$map' in value && Array.isArray(value.$map))
      return new Map(
        value.$map.map((pair) => {
          if (!Array.isArray(pair)) throw new Error('Invalid map');
          return [decode(pair[0]), decode(pair[1])];
        })
      );
    if ('$set' in value && Array.isArray(value.$set))
      return new Set(value.$set.map(decode));
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, decode(v)])
    );
  };
  const comparableSnapshot = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return Array.from(value, comparableSnapshot);
    const object = fields(value);
    if ('$key' in object) return object.raw;
    return Object.fromEntries(
      Object.entries(object).map(([key, entry]) => {
        if (key !== 'dirty') return [key, comparableSnapshot(entry)];
        const dirty = fields(entry);
        const nodeKey = (id: unknown) =>
          typeof id === 'number' ? fields(handles.get(`$h:${id}`)).__key : id;
        return [
          key,
          {
            leaves: (dirty.leaves as unknown[]).map(nodeKey),
            elements: (dirty.elements as unknown[][]).map(([id, flag]) => [
              nodeKey(id),
              flag,
            ]),
          },
        ];
      })
    );
  };
  const execute = (ops: Op[]): void => {
    for (const [index, op] of ops.entries()) {
      const previousErrorMustThrow = errorMustThrow;
      errorMustThrow = op.error !== undefined || op.throws !== undefined;
      try {
        if (op.op === 'createEditor') {
          const config = fields(op.config);
          const lexical = modules.get('lexical');
          if (!lexical || typeof lexical.createEditor !== 'function')
            throw new Error('No lexical oracle loaded');
          const create = config.headless
            ? modules.get('@lexical/headless')?.createHeadlessEditor
            : lexical.createEditor;
          if (typeof create !== 'function')
            throw new Error('Missing editor factory');
          const editor = create({
            namespace: config.namespaceGenerated ? undefined : config.namespace,
            theme: decode(config.theme as Value),
            editable: config.editable,
            nodes: [
              ...(config.nodes as Value[]).map((node) =>
                decode(
                  (config.nodeClasses as Record<string, Value> | undefined)?.[
                    String(node)
                  ] ?? { $klass: node }
                )
              ),
              ...((config.replacements ?? []) as Value[]).map(decode),
            ],
            onError: (error: Error) => {
              if (errorMustThrow) throw error;
            },
          });
          if (fixture.partial && op.id === 0)
            restoreInitial(
              editor,
              fixture.initial,
              lexical,
              modules.get('lexical/LexicalUtils') ?? {}
            );
          if (observer.editor(editor) !== op.id)
            throw new Error('Editor id mismatch');
          editors.set(Number(op.id), editor);
          if (config.rootElement) {
            const root = document.createElement('div');
            root.contentEditable = 'true';
            document.body.append(root);
            roots.push(root);
            editor.setRootElement(root);
          }
          if (op.ret) compare(op.ret, editor);
        } else if (op.op === 'plugin') {
          const cleanup = Reflect.apply(
            lookup(String(op.name)),
            undefined,
            (op.args as Value[]).map(decode)
          );
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        } else if (op.op === 'call') {
          const receiver = op.this === undefined ? undefined : decode(op.this);
          const name = String(op.fn);
          const args = (op.args as Value[]).map(decode);
          let result: unknown;
          let thrown: unknown;
          let didThrow = false;
          const exit = observer.enter();
          try {
            if (name.startsWith('get:'))
              result = fields(receiver)[name.slice(4)];
            else if (name === 'iter')
              result = Array.from(receiver as Iterable<unknown>);
            else if (receiver !== undefined) {
              const fn =
                fields(receiver)[name.slice(name.lastIndexOf('.') + 1)];
              if (typeof fn !== 'function')
                throw new Error(`Missing method ${name}`);
              result = Reflect.apply(fn, receiver, args);
            } else result = Reflect.apply(lookup(name), undefined, args);
          } catch (error) {
            didThrow = true;
            thrown = error;
          } finally {
            exit();
          }
          if (op.throws) {
            if (!didThrow) throw new Error('Expected throw');
            compare(op.throws, errorValue(thrown));
          } else {
            if (didThrow) throw thrown;
            compare(op.ret === undefined ? { $undef: true } : op.ret, result);
          }
        } else if (op.op === 'update' || op.op === 'read') {
          if (op.op === 'update' && op.cause !== 'test') continue;
          const receiver = op.state
            ? decode(op.state)
            : editors.get(Number(op.editor));
          if (op.op === 'update')
            observer.admitUpdate(fields(receiver), Number(op.id));
          const fn = fields(receiver)[op.op];
          if (typeof fn !== 'function') throw new Error(`Missing ${op.op}`);
          let thrown: unknown;
          let didThrow = false;
          try {
            Reflect.apply(fn, receiver, [
              () => execute(op.calls as Op[]),
              decode(op.opts ?? {}),
            ]);
          } catch (error) {
            didThrow = true;
            thrown = error;
          }
          if (op.error) {
            if (!didThrow) throw new Error('Expected update/read error');
            compare(op.error, errorValue(thrown));
          } else if (didThrow) throw thrown;
        } else if (op.op === 'commit') {
          const actual = commits.shift();
          if (
            !actual ||
            actual.editor !== op.editor ||
            actual.index !== op.index ||
            !isDeepStrictEqual(actual.updates, op.updates) ||
            !isDeepStrictEqual(actual.causes, op.causes) ||
            !isDeepStrictEqual(
              comparableSnapshot(actual.snapshot),
              comparableSnapshot(op.snapshot)
            )
          )
            throw new Error(
              `Commit snapshot mismatch: ${difference(actual && { ...actual, snapshot: comparableSnapshot(actual.snapshot) }, { ...op, snapshot: comparableSnapshot(op.snapshot) })}`
            );
        } else if (op.op === 'log') {
          if (!isDeepStrictEqual(logs.shift(), op))
            throw new Error('Log mismatch');
        } else if (op.op === 'error') {
          const actual = errors.shift();
          if (
            !actual ||
            actual.name !== op.name ||
            actual.message !== op.message ||
            actual.during !== op.during ||
            actual.editor !== op.editor
          )
            throw new Error('Error event mismatch');
        } else if (op.op !== 'clock' && op.op !== 'entropy') {
          throw new Error(`Unsupported operation ${op.op}`);
        }
        if (mismatch) throw mismatch;
      } catch (error) {
        mismatch ??= new Error(
          `self-replay-failed: ${index} ${op.op} ${op.fn ?? ''}: ${errorValue(error).message}`,
          { cause: error }
        );
        throw mismatch;
      } finally {
        errorMustThrow = previousErrorMustThrow;
      }
    }
  };
  let succeeded = false;
  try {
    entropy.install();
    // Use hooks without enabling the membrane during replay.
    const hooks = fields(fields(globalThis).__lexRec);
    const previous = { ...hooks };
    Object.assign(hooks, {
      enter: observer.enter.bind(observer),
      begin: observer.begin.bind(observer),
      commit: observer.commit.bind(observer),
      error: observer.error.bind(observer),
    });
    try {
      for (const op of fixture.trace) {
        if (op.op === 'tick') await Promise.resolve();
        else execute([op]);
      }
      const last = [...editors.values()].at(-1);
      compare(
        comparableSnapshot(fixture.final) as Value,
        last ? snapshot(last) : null
      );
      positions.forEach((count, n) => {
        if (count !== fixture.tapes[n].invocations.length)
          throw new Error(`Missing tape invocations ${n}`);
      });
      if (commits.length) throw new Error('Unconsumed commits');
      if (errors.length) throw new Error('Unconsumed errors');
      if (logs.length) throw new Error('Unconsumed logs');
      succeeded = true;
    } finally {
      Object.assign(hooks, previous);
      for (const cleanup of cleanups.reverse()) cleanup();
      for (const editor of editors.values()) {
        const raw = fields(editor);
        raw._pendingEditorState = null;
        raw._updates = [];
        raw._deferred = [];
      }
      for (const root of roots) root.remove();
    }
  } finally {
    restoreEvents();
    entropy.dispose(succeeded);
  }
}
