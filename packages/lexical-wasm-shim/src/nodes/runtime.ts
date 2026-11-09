import type { ShimBackend } from '../backend';
import { NodeHandles } from '../handles';
import { foreignHooks } from '../hooks.generated';
import type { LexicalNode } from './index';

export interface Binding {
  readonly runtime: NodeRuntime;
  readonly handle: number;
}
const bindings = new WeakMap<object, Binding>();

let activeRuntime: NodeRuntime | undefined;
let hydratingNative = false;

export function getNodeRuntime(): NodeRuntime {
  if (activeRuntime === undefined)
    throw new Error('Unable to find an active editor state.');
  return activeRuntime;
}

export function nodeBinding(node: object): Binding {
  const binding = bindings.get(node);
  if (binding === undefined) throw new Error('node has no model record');
  return binding;
}

export function isNativeHydration(): boolean {
  return hydratingNative;
}

export function assertNodeIdentity(node: LexicalNode): void {
  const { runtime, handle } = nodeBinding(node);
  if (!runtime.handles.hasIdentity(handle, node))
    throw new Error('node has no stable model identity');
  const key = nodeField(node, '__key');
  if (typeof key !== 'string') throw new Error('node has an invalid model key');
  const current = getNodeRuntime().call('lexical.$getNodeByKey', [key]);
  if (current !== node)
    throw new Error('node is not the exact active model capture');
}

export { assumeNodeType, nodeConfigRecord } from '../compatibility-exceptions';
export {
  nodeByKey,
  nodeIsComposing,
  nodeIsDirty,
  nodeLatest,
  nodeSelect,
  nodeWritable,
  nodeWriteField,
} from './runtime-primitives';

/** Only builtin hydration uses this scope; no native record is allocated. */
export function withNativeHydration<T>(body: () => T): T {
  const previous = hydratingNative;
  hydratingNative = true;
  try {
    return body();
  } finally {
    hydratingNative = previous;
  }
}

export function withNodeRuntime<T>(runtime: NodeRuntime, body: () => T): T {
  const previous = activeRuntime;
  activeRuntime = runtime;
  try {
    return body();
  } finally {
    activeRuntime = previous;
  }
}

export function constructNode(
  node: LexicalNode,
  type: string,
  key: string | undefined,
  text: string
): void {
  if (hydratingNative) return;
  if (activeRuntime === undefined)
    throw new Error('node construction requires an active editor');
  if (key !== undefined)
    throw new Error('explicit-key construction requires clone staging');
  const names: Readonly<Record<string, string | undefined>> = {
    text: 'lexical.$createTextNode',
    paragraph: 'lexical.$createParagraphNode',
    linebreak: 'lexical.$createLineBreakNode',
    tab: 'lexical.$createTabNode',
  };
  const name = names[type];
  if (name === undefined)
    throw new Error(`unregistered JS constructor ${type}`);
  const raw = activeRuntime.backend.call(name, type === 'text' ? [text] : []);
  activeRuntime.adopt(raw, node);
}

/** One editor's conversion boundary; node objects never serialize their own fields. */
export class NodeRuntime {
  readonly handles: NodeHandles<LexicalNode>;

  constructor(
    readonly backend: ShimBackend,
    create: (type: string) => LexicalNode
  ) {
    this.handles = new NodeHandles(backend, (handle, _key, type) => {
      const node = create(type);
      bindings.set(node, { runtime: this, handle });
      return node;
    });
  }

  adopt(raw: unknown, node: LexicalNode): void {
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('$h' in raw) ||
      typeof raw.$h !== 'number'
    )
      throw new Error('invalid constructed node handle');
    this.handles.adopt(raw, node);
    bindings.set(node, { runtime: this, handle: raw.$h });
  }

  encode(value: unknown): unknown {
    if (value === undefined) return { $undef: true };
    if (value === null || typeof value !== 'object') return value;
    const binding = bindings.get(value);
    if (binding !== undefined) {
      if (binding.runtime === this) return { $h: binding.handle };
      const key = nodeField(value, '__key');
      const receiver = this.backend.call('lexical.$getNodeByKey', [key]);
      if (receiver === null) throw missingNode();
      return receiver;
    }
    if (Array.isArray(value)) return value.map((item) => this.encode(item));
    return value;
  }

  decode(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if ('$h' in value) return this.handles.node(value);
    if ('$undef' in value) return undefined;
    if ('$key' in value && 'raw' in value && typeof value.raw === 'string')
      return value.raw === '0' ? 'root' : value.raw;
    if (Array.isArray(value)) return value.map((item) => this.decode(item));
    return value;
  }

  call(name: string, args: readonly unknown[]): unknown {
    return this.decode(
      this.backend.call(
        name,
        args.map((arg) => this.encode(arg))
      )
    );
  }
}

export function nodeCall(
  node: LexicalNode,
  method: string,
  args: readonly unknown[]
): unknown {
  const binding = bindings.get(node);
  if (binding === undefined) throw new Error('node has no model record');
  if (activeRuntime === undefined)
    throw new Error('Unable to find an active editor state.');
  const runtime = activeRuntime;
  const receiver = runtime.encode(node);
  const name = `LexicalNode.${method}`;
  const encoded = args.map((arg) => runtime.encode(arg));
  const hook = foreignHooks.some(
    (hook) => !hook.static && hook.name === method
  );
  const result = hook
    ? runtime.backend.callNative(name, encoded, receiver)
    : runtime.backend.call(name, encoded, receiver);
  return runtime.decode(result);
}

export function nodeField(node: object, field: string): unknown {
  const binding = bindings.get(node);
  if (binding === undefined) throw new Error('node has no model record');
  return binding.runtime.decode(
    binding.runtime.backend.readField(binding.handle, field)
  );
}

function missingNode(): Error {
  return new Error(
    'Lexical node does not exist in active editor state. Avoid using the same node references between nested closures from editorState.read/editor.update.'
  );
}
