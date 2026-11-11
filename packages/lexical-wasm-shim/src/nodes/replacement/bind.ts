import { isInstanceOfKlass } from '../../compatibility-exceptions';
import { LexicalNode } from '../base';
import type {
  BoundNodeReplacement,
  ClassLike,
  LexicalNodeReplacement,
  NodeClass,
} from './types';

type PublicNodeClass = LexicalNodeReplacement['replace'];
type PublicReplacementResult = ReturnType<LexicalNodeReplacement['with']>;

export function actualNodeClass(klass: ClassLike): NodeClass {
  if (Object.is(klass, LexicalNode)) return LexicalNode;
  const prototype: unknown = klass.prototype;
  if (!(prototype instanceof LexicalNode))
    throw new Error(`Replacement class ${klass.name} must belong to this core`);
  const actualClass = prototype.constructor;
  if (!Object.is(actualClass, klass))
    throw new Error(`Replacement class ${klass.name} must belong to this core`);
  return actualClass;
}

/** Bind the class-specific callback while its constructor type is in scope. */
export function bindReplacement<
  T extends NodeClass | PublicNodeClass,
>(replacement: {
  replace: T;
  with: (node: InstanceType<T>) => LexicalNode | PublicReplacementResult;
  withKlass?: NodeClass | PublicNodeClass;
}): BoundNodeReplacement {
  const klass = replacement.replace;
  const callback = replacement.with;
  const withKlass = replacement.withKlass;
  return {
    replace: actualNodeClass(klass),
    withKlass: withKlass ? actualNodeClass(withKlass) : undefined,
    with: (node: LexicalNode) => {
      if (!isInstanceOfKlass(node, klass))
        throw new Error(
          `Replacement input must be an instance of ${klass.name}`
        );
      const result = callback(node);
      if (!(result instanceof LexicalNode))
        throw new Error(
          'Replacement callback must return a node from this core'
        );
      return result;
    },
  };
}
