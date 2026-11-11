/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type {
  SerializedEditorState,
  SerializedLexicalNode,
  SerializedRootNode,
} from 'lexical';
import type { EditorState } from '../editor';
import { ElementNode, type LexicalNode, type RootNode } from '../nodes';
import { getJSONRuntime } from './runtime';

function appendSerializedChildren(
  node: LexicalNode,
  serialized: SerializedLexicalNode
): void {
  const klass = node.constructor;
  if (serialized.type !== klass.getType())
    throw new Error(
      `LexicalNode: Node ${klass.name} does not match the serialized type. Check if .exportJSON() is implemented and it is returning the correct type.`
    );
  if (node instanceof ElementNode) {
    const withChildren: SerializedLexicalNode & { children?: unknown } =
      serialized;
    const children = withChildren.children;
    if (!Array.isArray(children))
      throw new Error(
        `LexicalNode: Node ${klass.name} is an element but .exportJSON() does not have a children array.`
      );
    const serializedChildren: unknown[] = children;
    const nodes = node.getChildren();
    for (let index = 0; index < nodes.length; index++) {
      const child = exportNodeToJSON(nodes[index]);
      serializedChildren.push(child);
    }
  }
}

export function exportNodeToJSON(node: LexicalNode): SerializedLexicalNode {
  const serialized = node.exportJSON();
  appendSerializedChildren(node, serialized);
  return serialized;
}

/** Preserve the actual Root method's strong return type without a generic cast. */
export function exportRootToJSON(root: RootNode): SerializedRootNode {
  const serialized = root.exportJSON();
  appendSerializedChildren(root, serialized);
  return serialized;
}

export function exportEditorState(state: EditorState): SerializedEditorState {
  const runtime = getJSONRuntime();
  return runtime.readEditorState(state, () => ({
    root: exportRootToJSON(runtime.getRoot()),
  }));
}
