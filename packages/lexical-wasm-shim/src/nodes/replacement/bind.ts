import { isInstanceOfKlass } from '../../compatibility-exceptions';
import type { LexicalNode } from '../base';
import type { BoundNodeReplacement, NodeClass } from './types';

/** Bind the class-specific callback while its constructor type is in scope. */
export function bindReplacement<T extends NodeClass>(replacement: {
  replace: T;
  with: (node: InstanceType<T>) => LexicalNode;
  withKlass?: NodeClass;
}): BoundNodeReplacement {
  const klass = replacement.replace;
  const callback = replacement.with;
  const withKlass = replacement.withKlass;
  return {
    replace: klass,
    withKlass,
    with: (node: LexicalNode) => {
      if (!isInstanceOfKlass(node, klass))
        throw new Error(
          `Replacement input must be an instance of ${klass.name}`
        );
      return callback(node);
    },
  };
}
