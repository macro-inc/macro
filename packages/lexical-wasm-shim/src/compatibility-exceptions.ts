/** The three upstream caller-assertion exceptions approved for compatibility. */
import type { NodeKey } from 'lexical';
import { LexicalNode } from './nodes';
import type { BaseStaticNodeConfig } from './nodes/config';
import { assertNodeIdentity } from './nodes/runtime';
import type { PointType } from './selection';
import { Point } from './selection/point';

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
