/** The seven upstream declaration/runtime exceptions approved for compatibility. */
import type { NodeKey } from 'lexical';
import { DequeSet } from './command/deque-set';
import type { CommandBucket, CommandRegistry } from './command/types';
import type { LexicalCommand } from './commands';
import { LexicalNode } from './nodes';
import type { BaseStaticNodeConfig } from './nodes/config';
import { assertNodeIdentity } from './nodes/runtime';
import type { NodeStateJSON, ValueOrUpdater } from './nodes/state/types';
import type { PointType } from './selection';
import { Point } from './selection/point';

/** A runtime witness for generic constructor instances; this is not an assertion. */
export function isInstanceOfKlass<
  T extends abstract new (
    ...args: never[]
  ) => unknown,
>(value: unknown, klass: T): value is InstanceType<T> {
  return value instanceof klass;
}

type NodeConfigRecord<Type extends string, Config> = BaseStaticNodeConfig & {
  readonly [K in Type]?: Config;
};

export function assumeNodeType<T extends LexicalNode>(node: LexicalNode): T {
  if (!(node instanceof LexicalNode))
    throw new Error('expected a compat LexicalNode');
  assertNodeIdentity(node);
  return node as T;
}

export function nodeConfigRecord<Type extends string, Config>(
  type: Type,
  config: Config
): NodeConfigRecord<Type, Config> {
  const record = { [type]: config };
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 1 || keys[0] !== type)
    throw new Error('expected a single-key node config record');
  return record as NodeConfigRecord<Type, Config>;
}

export function createPointWithUpstreamType(
  key: NodeKey,
  offset: number,
  type: 'text' | 'element'
): PointType {
  const point = new Point(key, offset, type);
  if (
    point._selection !== null ||
    point.key !== key ||
    !Object.is(point.offset, offset) ||
    point.type !== type
  )
    throw new Error('invalid owner-less point construction');
  return point as PointType;
}

export function applyValueOrUpdater<V>(
  valueOrUpdater: ValueOrUpdater<V>,
  previous: V
): V {
  return typeof valueOrUpdater === 'function'
    ? (valueOrUpdater as (value: V) => V)(previous)
    : valueOrUpdater;
}

export function nodeStateToJSON<T extends LexicalNode>(
  value: Record<string, unknown>
): NodeStateJSON<T> {
  return value as NodeStateJSON<T>;
}

export function commandBucket<P>(
  registry: CommandRegistry,
  command: LexicalCommand<P>
): CommandBucket<P> {
  const bucket = registry.get(command);
  if (bucket === undefined) throw new Error('Command bucket is not registered');
  if (
    !Array.isArray(bucket) ||
    bucket.length !== 5 ||
    !Array.from(bucket).every((listeners) => listeners instanceof DequeSet)
  )
    throw new Error(
      'Command bucket must contain five DequeSet priority groups'
    );
  return bucket as CommandBucket<P>;
}

/** Upstream invokes HTMLElement-declared DOM factories/converters with real Node. */
export function invokeDOMConversionWithNode<R>(
  conversion: (node: HTMLElement) => R,
  node: Node
): R {
  return conversion(node as HTMLElement);
}
