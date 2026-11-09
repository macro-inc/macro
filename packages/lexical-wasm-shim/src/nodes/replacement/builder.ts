/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { LexicalNode } from '../base';
import { createSharedNodeState, getStaticNodeConfig } from '../static-config';
import type {
  InternalNodeConfig,
  NodeClass,
  NodeDOMExport,
  RegisteredNodes,
  Transform,
} from './types';

function hasOwnStaticMethod<K extends keyof NodeClass>(
  klass: NodeClass,
  key: K
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(klass, key) &&
    klass[key] !== LexicalNode[key]
  );
}

function parentClass(klass: NodeClass): NodeClass | undefined {
  const parent: unknown = Object.getPrototypeOf(klass);
  if (
    typeof parent === 'function' &&
    'prototype' in parent &&
    parent.prototype instanceof LexicalNode &&
    parent.prototype.constructor === parent
  )
    return parent.prototype.constructor;
  return undefined;
}

export function getTransformSetFromKlass(
  klass: NodeClass
): Set<Transform<LexicalNode>> {
  const transforms = new Set<Transform<LexicalNode>>();
  const staticTransforms = new Set<NodeClass['transform']>();
  let current: NodeClass | undefined = klass;
  while (current) {
    const { ownNodeConfig } = getStaticNodeConfig(current);
    const staticTransform = current.transform;
    if (!staticTransforms.has(staticTransform)) {
      staticTransforms.add(staticTransform);
      const transform = current.transform();
      if (transform) transforms.add(transform);
    }
    if (ownNodeConfig) {
      const transform = ownNodeConfig.$transform;
      if (transform) transforms.add(transform);
      current = ownNodeConfig.extends;
    } else current = parentClass(current);
  }
  return transforms;
}

function validateReplacement(
  klass: NodeClass,
  replace: ((node: LexicalNode) => LexicalNode) | null,
  replaceWithKlass: NodeClass | null
): void {
  if (process.env.NODE_ENV !== 'production') {
    const name = klass.name;
    const type = hasOwnStaticMethod(klass, 'getType') && klass.getType();
    if (replaceWithKlass) {
      if (!(replaceWithKlass.prototype instanceof klass))
        throw new Error(`${replaceWithKlass.name} doesn't extend the ${name}`);
    } else if (replace)
      console.warn(
        `Override for ${name} specifies 'replace' without 'withKlass'. 'withKlass' will be required in a future version.`
      );
    if (
      name !== 'RootNode' &&
      type !== 'root' &&
      type !== 'artificial' &&
      klass !== LexicalNode
    ) {
      if (!hasOwnStaticMethod(klass, 'getType'))
        console.warn(`${name} must implement static "getType" method`);
      if (!hasOwnStaticMethod(klass, 'clone'))
        console.warn(`${name} must implement static "clone" method`);
      if (
        !hasOwnStaticMethod(klass, 'importDOM') &&
        Object.prototype.hasOwnProperty.call(klass.prototype, 'exportDOM')
      )
        console.warn(
          `${name} should implement "importDOM" if using a custom "exportDOM" method to ensure HTML serialization (important for copy & paste) works as expected`
        );
      if (!hasOwnStaticMethod(klass, 'importJSON'))
        console.warn(
          `${name} should implement "importJSON" method to ensure JSON and default HTML serialization works as expected`
        );
    }
  }
}

/** Build metadata only; the editor supplies the complete explicit class list. */
export function buildRegisteredNodes(
  configs: Iterable<InternalNodeConfig>,
  exportDOM?: Pick<ReadonlyMap<NodeClass, NodeDOMExport>, 'get'>
): RegisteredNodes {
  const registered: RegisteredNodes = new Map();
  for (const config of configs) {
    const klass = typeof config === 'function' ? config : config.replace;
    const replace = typeof config === 'function' ? null : config.with;
    const replaceWithKlass =
      typeof config === 'function' ? null : config.withKlass || null;
    getStaticNodeConfig(klass);
    validateReplacement(klass, replace, replaceWithKlass);
    const type = klass.getType();
    const transforms = getTransformSetFromKlass(klass);
    registered.set(type, {
      klass,
      transforms,
      replace,
      replaceWithKlass,
      exportDOM: exportDOM?.get(klass),
      sharedNodeState: createSharedNodeState(config),
    });
  }
  return registered;
}
