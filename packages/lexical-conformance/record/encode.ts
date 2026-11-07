import { fields, type Value } from './schema';

export const namedFunctions = new WeakMap<object, string>();
export const namedCommands = new WeakMap<object, string>();
export const namedTransformers = new WeakMap<object, string>();

/** Object identity is independent of the key: writable clones get distinct handles. */
export class Encoder {
  private handles = new WeakMap<object, Value>();
  private next = 0;
  readonly keys = new Map<string, number>();
  readonly functions = namedFunctions;
  version = 0;
  reset(): void {
    this.handles = new WeakMap();
    this.next = 0;
    this.keys.clear();
    this.version = 0;
  }

  encode(value: unknown): Value {
    if (value === undefined) return { $undef: true };
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const key = this.keys.get(value);
      return key === undefined ? value : { $key: key, raw: value };
    }
    if (typeof value === 'number') {
      if (Object.is(value, -0)) return { $num: '-0' };
      if (!Number.isFinite(value)) return { $num: String(value) };
      return value;
    }
    if (typeof value === 'function') {
      if ('getType' in value && typeof value.getType === 'function') {
        return { $klass: value.getType() };
      }
      const name = this.functions.get(value);
      if (name)
        return name.startsWith('tape:')
          ? { $tape: Number(name.slice(5)) }
          : { $fn: name };
      throw new Error('unsupported-function-value');
    }
    if (typeof value !== 'object')
      throw new Error(`unsupported-value: ${typeof value}`);
    const command = namedCommands.get(value);
    if (command) return { $cmd: command };
    const transformer = namedTransformers.get(value);
    if (transformer) return { $transformer: transformer };
    const known = this.handles.get(value);
    if (known) {
      const tag = Object.keys(known)[0];
      return { [tag]: fields(known)[tag] as Value };
    }
    const object = fields(value);
    let tag: string | undefined;
    if (typeof object.__key === 'string') tag = '$h';
    else if ('_editorState' in object) tag = '$ed';
    else if ('_nodeMap' in object) tag = '$state';
    else if ('anchor' in object && 'focus' in object) tag = '$sel';
    else if ('_nodes' in object) tag = '$sel';
    else if ('offset' in object && 'key' in object && 'type' in object)
      tag = '$pt';
    else if ('origin' in object && 'direction' in object) tag = '$caret';
    if (tag) {
      const id = this.next++;
      const handle: { [key: string]: Value } = { [tag]: id };
      this.handles.set(value, handle);
      if (tag === '$h') {
        const key = String(object.__key);
        this.keys.set(key, id);
        handle.key = key;
        handle.type = String(object.__type);
        handle.ver = this.version;
      } else if (tag === '$sel') {
        handle.kind = 'anchor' in object ? 'range' : 'node';
      } else if (tag === '$caret') {
        handle.origin = this.encode(object.origin);
        handle.direction = this.encode(object.direction);
        handle.type = this.encode(object.type);
      }
      return { ...handle };
    }
    if (Array.isArray(value)) return value.map((item) => this.encode(item));
    if (value instanceof Map)
      return {
        $map: [...value].map(([k, v]) => [this.encode(k), this.encode(v)]),
      };
    if (value instanceof Set)
      return { $set: [...value].map((item) => this.encode(item)) };
    if (value instanceof RegExp)
      return {
        $regexp: value.source,
        flags: value.flags,
        lastIndex: value.lastIndex,
      };
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error(`unsupported-object: ${value.constructor.name}`);
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, this.encode(v)])
    );
  }
}
