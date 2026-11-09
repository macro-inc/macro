/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import { assumeNodeType } from '../../compatibility-exceptions';
import type { LexicalNode } from '../base';
import {
  getRegisteredNode,
  getRegisteredNodeByClass,
  resolveRegisteredNodeAfterReplacements,
} from './lookup';
import { getReplacementRuntime } from './runtime';
import type { Klass } from './types';

export function $applyNodeReplacement<N extends LexicalNode>(node: N): N {
  const editor = getReplacementRuntime().getActiveEditor();
  const type = node.getType();
  const registered = getRegisteredNode(editor, type);
  if (registered === undefined)
    throw new Error(
      `$applyNodeReplacement node ${node.constructor.name} with type ${type} must be registered to the editor. You can do this by passing the node class via the "nodes" array in the editor config.`
    );
  const { replace, replaceWithKlass } = registered;
  if (replace !== null) {
    const replacement = replace(node);
    const replacementKlass = replacement.constructor;
    if (replaceWithKlass !== null) {
      if (!(replacement instanceof replaceWithKlass))
        throw new Error(
          `$applyNodeReplacement failed. Expected replacement node to be an instance of ${replaceWithKlass.name} with type ${replaceWithKlass.getType()} but returned ${replacementKlass.name} with type ${replacementKlass.getType()} from original node ${node.constructor.name} with type ${type}`
        );
    } else if (
      !(
        replacement instanceof node.constructor &&
        replacementKlass !== node.constructor
      )
    )
      throw new Error(
        `$applyNodeReplacement failed. Ensure replacement node ${replacementKlass.name} with type ${replacementKlass.getType()} is a subclass of the original node ${node.constructor.name} with type ${type}.`
      );
    if (replacement.__key === node.__key)
      throw new Error(
        `$applyNodeReplacement failed. Ensure that the key argument is *not* used in your replace function (from node ${node.constructor.name} with type ${type} to node ${replacementKlass.name} with type ${replacementKlass.getType()}), Node keys must never be re-used except by the static clone method.`
      );
    return assumeNodeType<N>(replacement);
  }
  return node;
}

export function $create<T extends LexicalNode>(klass: Klass<T>): T {
  const runtime = getReplacementRuntime();
  const editor = runtime.getActiveEditor();
  runtime.errorOnReadOnly();
  const registered = resolveRegisteredNodeAfterReplacements(
    editor,
    getRegisteredNodeByClass(editor, klass)
  );
  return assumeNodeType<T>(new registered.klass());
}
