/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { SerializedLexicalNode } from 'lexical';
import { ElementNode, type LexicalNode } from '../nodes';
import type { RegisteredNodes } from '../nodes/replacement/types';
import { getJSONRuntime } from './runtime';

type InternalSerializedNode = {
  children?: InternalSerializedNode[];
  type: string;
  version: number;
};

/** Internal recursive component; callers supply actual prepared registrations. */
export function parseSerializedNodeWithRegistry(
  serialized: InternalSerializedNode,
  registered: RegisteredNodes
): LexicalNode {
  const type = serialized.type;
  const entry = registered.get(type);
  if (entry === undefined)
    throw new Error(`parseEditorState: type "${type}" + not found`);
  const klass = entry.klass;
  if (serialized.type !== klass.getType())
    throw new Error(
      `LexicalNode: Node ${klass.name} does not implement .importJSON().`
    );
  const node = klass.importJSON(serialized);
  const children = serialized.children;
  if (node instanceof ElementNode && Array.isArray(children)) {
    for (let index = 0; index < children.length; index++) {
      const child = parseSerializedNodeWithRegistry(
        children[index],
        registered
      );
      node.append(child);
    }
  }
  return node;
}

export function $parseSerializedNode(
  serialized: SerializedLexicalNode
): LexicalNode {
  const runtime = getJSONRuntime();
  return parseSerializedNodeWithRegistry(
    serialized,
    runtime.getRegisteredNodes(runtime.getActiveEditor())
  );
}
