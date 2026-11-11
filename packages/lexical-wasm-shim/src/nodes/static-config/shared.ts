/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { LexicalNode } from '../base';
import { SharedState } from '../state/shared';
import { getStaticNodeConfig } from './prepare';

type NodeClass = LexicalNode['constructor'];

export function createSharedNodeState(
  nodeConfig: NodeClass | { readonly replace: NodeClass }
): SharedState {
  const shared = new SharedState();
  let klass: NodeClass | undefined =
    typeof nodeConfig === 'function' ? nodeConfig : nodeConfig.replace;
  while (klass?.prototype && klass.prototype.getType !== undefined) {
    const { ownNodeConfig } = getStaticNodeConfig(klass);
    if (ownNodeConfig?.stateConfigs) {
      for (const required of ownNodeConfig.stateConfigs) {
        const config =
          'stateConfig' in required ? required.stateConfig : required;
        if ('stateConfig' in required && required.flat)
          shared.flatKeys.add(config.key);
        shared.sharedConfigMap.set(config.key, config);
      }
    }
    const parent: unknown = Object.getPrototypeOf(klass);
    if (parent === LexicalNode) klass = LexicalNode;
    else if (
      typeof parent === 'function' &&
      'prototype' in parent &&
      parent.prototype instanceof LexicalNode &&
      parent.prototype.constructor === parent
    )
      klass = parent.prototype.constructor;
    else klass = undefined;
  }
  return shared;
}
