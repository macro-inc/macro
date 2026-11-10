import {
  DIFF_FORMAT_VERSION,
  DiffOpcode,
} from '@macro-inc/collaboration/session/abi.generated';
import type {
  AppliedDiff,
  ElementProps,
  JsonObject,
  JsonValue,
  NodeKey,
  NodeMutation,
  TextProps,
  TypeRow,
  ViewNode,
} from './types';

export const NO_KEY = 0xffff_ffff;
const decoder = new TextDecoder('utf-8', { fatal: true });

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (Array.isArray(value)) return Object.freeze(value.map(jsonValue));
  if (typeof value !== 'object') throw new Error('Invalid node properties');
  const entries: [string, JsonValue][] = [];
  for (const [key, child] of Object.entries(value))
    entries.push([key, jsonValue(child)]);
  return Object.freeze(Object.fromEntries(entries));
}
function properties(text: string): JsonObject {
  const value = jsonValue(text ? JSON.parse(text) : {});
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Node properties must be an object');
  // Arrays have already been excluded; this boundary narrows parsed JSON to its record form.
  const result: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) result[key] = child;
  return Object.freeze(result);
}
type NodeData = Omit<ViewNode, 'props'>;
function record(data: NodeData): ViewNode {
  let cached: JsonObject | undefined;
  return Object.freeze({
    ...data,
    children: Object.isFrozen(data.children)
      ? data.children
      : Object.freeze([...data.children]),
    props() {
      cached ??= properties(data.propsJSON);
      return cached;
    },
  });
}
class Reader {
  at = 0;
  constructor(
    readonly words: Uint32Array,
    readonly strings: Uint8Array
  ) {}
  word(): number {
    if (this.at === this.words.length) throw new Error('Truncated Diff');
    return this.words[this.at++];
  }
  string(): string {
    const start = this.word(),
      length = this.word();
    if (start > this.strings.length || length > this.strings.length - start)
      throw new Error('Invalid Diff string range');
    return decoder.decode(this.strings.subarray(start, start + length));
  }
  text(): TextProps {
    return Object.freeze({
      format: this.word(),
      mode: this.word(),
      detail: this.word(),
      style: '',
    });
  }
  element(): ElementProps {
    return Object.freeze({
      format: this.word(),
      indent: this.word(),
      direction: this.word(),
      textFormat: this.word(),
      style: this.string(),
      textStyle: this.string(),
    });
  }
}

/** The sole writer of mirror records. Renderers receive immutable snapshots. */
export class Mirror {
  private readonly records = new Map<NodeKey, ViewNode>();
  private readonly types: ReadonlyMap<number, TypeRow>;
  private generation: number | null = null;
  private textLengthValue = 0;
  private readonly nonemptyRootChildren = new Set<NodeKey>();
  constructor(types: readonly TypeRow[]) {
    const table = new Map<number, TypeRow>();
    for (const row of types) {
      if (table.has(row.index)) throw new Error('Duplicate view type index');
      table.set(row.index, Object.freeze({ ...row }));
    }
    this.types = table;
  }
  node(key: NodeKey): ViewNode | null {
    return this.records.get(key) ?? null;
  }
  type(index: number): TypeRow {
    const row = this.types.get(index);
    if (!row) throw new Error('Unknown view type index: ' + index);
    return row;
  }
  values(): IterableIterator<ViewNode> {
    return this.records.values();
  }
  get size(): number {
    return this.records.size;
  }
  /** UTF-16 code units in mirrored text nodes; maintained from accepted mutations. */
  get textLength(): number {
    return this.textLengthValue;
  }
  get keyGeneration(): number | null {
    return this.generation;
  }
  /** Same blank-paragraph/watermark predicate as the native editor consumer. */
  get isEmpty(): boolean | null {
    return this.records.has(0) ? this.nonemptyRootChildren.size === 0 : null;
  }
  private updateEmptiness(mutations: ReadonlyMap<NodeKey, NodeMutation>): void {
    const changed = new Set<NodeKey>();
    for (const [key, mutation] of mutations) {
      if (mutation.before?.parent === 0 || mutation.after?.parent === 0)
        changed.add(key);
      for (const parent of [mutation.before?.parent, mutation.after?.parent]) {
        if (
          parent != null &&
          (this.records.get(parent)?.parent === 0 ||
            this.nonemptyRootChildren.has(parent))
        )
          changed.add(parent);
      }
    }
    for (const key of changed) {
      const node = this.records.get(key);
      const first = node?.children[0];
      const nonempty =
        node?.parent === 0 &&
        (node.type !== 'paragraph' ||
          node.elementProps?.indent !== 0 ||
          (first !== undefined &&
            this.records.get(first)?.type !== 'watermark'));
      if (nonempty) this.nonemptyRootChildren.add(key);
      else this.nonemptyRootChildren.delete(key);
    }
  }
  /** Initialize is the only operation that may replace the key generation. */
  initialize(words: Uint32Array, strings: Uint8Array): AppliedDiff {
    this.records.clear();
    this.textLengthValue = 0;
    this.nonemptyRootChildren.clear();
    this.generation = null;
    return this.apply(words, strings);
  }
  apply(words: Uint32Array, strings: Uint8Array): AppliedDiff {
    const generation = this.generation;
    const undo = new Map<NodeKey, ViewNode | undefined>();
    try {
      const diff = this.applyDiff(words, strings, undo);
      // Do not alter derived counts until all packet and graph validation passes.
      this.updateEmptiness(diff.mutations);
      for (const { before, after } of diff.mutations.values()) {
        this.textLengthValue +=
          (after?.kind === 'text' ? after.text.length : 0) -
          (before?.kind === 'text' ? before.text.length : 0);
      }
      return diff;
    } catch (error) {
      for (const [key, node] of undo) {
        if (node) this.records.set(key, node);
        else this.records.delete(key);
      }
      this.generation = generation;
      throw error;
    }
  }
  private applyDiff(
    words: Uint32Array,
    strings: Uint8Array,
    undo: Map<NodeKey, ViewNode | undefined>
  ): AppliedDiff {
    const mutations = new Map<NodeKey, NodeMutation>();
    const children = new Set<NodeKey>(),
      props = new Set<NodeKey>();
    if (words.length === 0) {
      if (strings.length) throw new Error('Strings without a Diff');
      return {
        mutations,
        children,
        properties: props,
        fullReconcile: false,
        viewTextMatches: null,
        opCount: 0,
      };
    }
    const r = new Reader(words, strings);
    if (r.word() !== DIFF_FORMAT_VERSION)
      throw new Error('Unsupported Diff version');
    const generation = r.word();
    if (this.generation !== null && this.generation !== generation)
      throw new Error('Diff key generation changed');
    this.generation = generation;
    const full = r.word();
    if (full > 1) throw new Error('Invalid full-reconcile flag');
    const matches = r.word(),
      count = r.word();
    const change = (key: NodeKey, next: ViewNode | undefined) => {
      if (!undo.has(key)) undo.set(key, this.records.get(key));
      const prior = mutations.get(key);
      const before = prior ? prior.before : this.records.get(key);
      if (next) this.records.set(key, next);
      else this.records.delete(key);
      if (!before && !next) mutations.delete(key);
      else
        mutations.set(key, {
          kind: before ? (next ? 'updated' : 'destroyed') : 'created',
          before,
          after: next,
        });
    };
    const get = (key: NodeKey) => {
      const node = this.records.get(key);
      if (!node) throw new Error('Diff references missing key: ' + key);
      return node;
    };
    const update = (key: NodeKey, patch: Partial<NodeData>) =>
      change(key, record({ ...get(key), ...patch }));
    // Session Initialize diffs compare against an empty editor with a root.
    // Materialize that implicit root through the applier before applying ops.
    if (
      this.records.size === 0 &&
      !(r.words[r.at] === DiffOpcode.CreateElement && r.words[r.at + 1] === 0)
    ) {
      const root = [...this.types.values()].find((row) => row.name === 'root');
      if (!root) throw new Error('Missing root type');
      change(
        0,
        record({
          key: 0,
          type: 'root',
          typeIndex: root.index,
          kind: 'root',
          parent: null,
          children: [],
          text: '',
          elementProps: {
            format: 0,
            indent: 0,
            direction: 0,
            textFormat: 0,
            style: '',
            textStyle: '',
          },
          propsJSON: '',
          stateJSON: '',
        })
      );
    }
    for (let i = 0; i < count; i++) {
      const op = r.word(),
        key = r.word();
      if (op === DiffOpcode.Remove) {
        if (key === 0) throw new Error('Cannot remove the mirror root');
        const subtreeRoot = r.word();
        if (subtreeRoot > 1) throw new Error('Invalid subtree-root flag');
        if (!this.records.has(key)) {
          if (mutations.get(key)?.kind === 'destroyed') continue;
          throw new Error('Removing missing key: ' + key);
        }
        const pending = [key];
        while (pending.length) {
          const current = pending.pop();
          if (current === undefined) break;
          const node = get(current);
          pending.push(...node.children);
          change(current, undefined);
        }
      } else if (
        op >= DiffOpcode.CreateElement &&
        op <= DiffOpcode.CreateLineBreak
      ) {
        if (this.records.has(key))
          throw new Error('Creating existing key: ' + key);
        const typeIndex = r.word(),
          type = this.type(typeIndex);
        if ((type.name === 'root') !== (key === 0))
          throw new Error('Invalid root key');
        let elementProps: ElementProps | undefined,
          textProps: TextProps | undefined;
        let text = '',
          propsJSON = '';
        if (op === DiffOpcode.CreateElement) {
          elementProps = r.element();
          propsJSON = r.string();
        } else if (op === DiffOpcode.CreateText) {
          const base = r.text();
          text = r.string();
          textProps = Object.freeze({ ...base, style: r.string() });
          propsJSON = r.string();
        } else if (op === DiffOpcode.CreateDecorator) propsJSON = r.string();
        const expected =
          op === DiffOpcode.CreateElement
            ? 'element'
            : op === DiffOpcode.CreateText
              ? 'text'
              : op === DiffOpcode.CreateDecorator
                ? 'decorator'
                : 'linebreak';
        if (type.kind !== expected)
          throw new Error('Diff type kind mismatch: ' + type.name);
        change(
          key,
          record({
            key,
            type: type.name,
            typeIndex,
            kind: type.name === 'root' ? 'root' : type.kind,
            parent: null,
            children: [],
            text,
            textProps,
            elementProps,
            propsJSON,
            stateJSON: '',
          })
        );
      } else if (op === DiffOpcode.Children) {
        const parent = get(key);
        if (parent.kind !== 'element' && parent.kind !== 'root')
          throw new Error('Children on a non-element');
        const length = r.word();
        if (length > r.words.length - r.at)
          throw new Error('Truncated children');
        const next: NodeKey[] = [];
        const unique = new Set<NodeKey>();
        for (let j = 0; j < length; j++) {
          const child = r.word();
          get(child);
          if (child === key || unique.has(child))
            throw new Error('Invalid child list');
          unique.add(child);
          next.push(child);
        }
        for (const child of parent.children) {
          if (!unique.has(child) && this.records.get(child)?.parent === key)
            update(child, { parent: null });
        }
        for (const child of next) {
          const record = get(child);
          if (record.parent !== key) {
            update(child, { parent: key });
            if (record.kind === 'element') props.add(child);
          }
        }
        update(key, { children: next });
        children.add(key);
      } else if (op === DiffOpcode.Text) {
        if (get(key).kind !== 'text')
          throw new Error('Text on a non-text node');
        update(key, { text: r.string() });
        props.add(key);
      } else if (op === DiffOpcode.TextProps) {
        if (get(key).kind !== 'text')
          throw new Error('Text properties on a non-text node');
        update(key, {
          textProps: Object.freeze({ ...r.text(), style: r.string() }),
        });
        props.add(key);
      } else if (op === DiffOpcode.ElementProps) {
        const node = get(key);
        if (node.kind !== 'element' && node.kind !== 'root')
          throw new Error('Element properties on a non-element');
        update(key, { elementProps: r.element() });
        props.add(key);
      } else if (op === DiffOpcode.NodeProps) {
        update(key, { propsJSON: r.string() });
        props.add(key);
      } else if (op === DiffOpcode.State) {
        update(key, { stateJSON: r.string() });
      } else if (op === DiffOpcode.SetDecoratorRevision) {
        const node = get(key);
        if (node.kind !== 'decorator')
          throw new Error('Decorator revision on a non-decorator');
        const low = r.word();
        const high = r.word();
        const revision = (BigInt(high) << 32n) | BigInt(low);
        if (node.decoratorRevision !== revision)
          update(key, { decoratorRevision: revision });
      } else throw new Error('Unknown Diff opcode: ' + op);
    }
    if (r.at !== words.length) throw new Error('Trailing Diff words');
    if (this.records.get(0)?.parent !== null)
      throw new Error('Cyclic or reparented mirror root');
    for (const key of children) {
      const node = this.records.get(key);
      if (!node) continue;
      for (const child of node.children)
        if (get(child).parent !== key)
          throw new Error('Child has multiple parents');
      const ancestors = new Set<number>();
      for (
        let parent: ViewNode | undefined = node;
        parent;
        parent =
          parent.parent === null ? undefined : this.records.get(parent.parent)
      ) {
        if (ancestors.has(parent.key)) throw new Error('Cyclic mirror tree');
        ancestors.add(parent.key);
      }
    }

    return {
      mutations,
      children,
      properties: props,
      fullReconcile: full === 1,
      viewTextMatches: matches === NO_KEY ? null : matches,
      opCount: count,
    };
  }
  /** Only a flags=0 successful TextFromView may enter this acknowledgement path. */
  acknowledgeText(key: NodeKey, text: string): AppliedDiff {
    if (this.generation === null)
      throw new Error('Acknowledgement before Initialize');
    const strings = new TextEncoder().encode(text);
    return this.apply(
      new Uint32Array([
        DIFF_FORMAT_VERSION,
        this.generation,
        0,
        key,
        1,
        DiffOpcode.Text,
        key,
        0,
        strings.length,
      ]),
      strings
    );
  }
}
