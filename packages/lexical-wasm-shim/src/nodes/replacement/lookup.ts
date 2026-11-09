import type { LexicalEditor } from '../../editor';
import { getReplacementRuntime } from './runtime';
import type { NodeClass, RegisteredNode } from './types';

export function getRegisteredNode(
  editor: LexicalEditor,
  nodeType: string
): RegisteredNode | undefined {
  return getReplacementRuntime().getRegisteredNodes(editor).get(nodeType);
}

export function getRegisteredNodeOrThrow(
  editor: LexicalEditor,
  nodeType: string
): RegisteredNode {
  const registered = getRegisteredNode(editor, nodeType);
  if (registered === undefined)
    throw new Error(`registeredNode: Type ${nodeType} not found`);
  return registered;
}

export function getRegisteredNodeByClass(
  editor: LexicalEditor,
  klass: NodeClass
): RegisteredNode {
  const registered = getRegisteredNode(editor, klass.getType());
  if (registered === undefined)
    throw new Error(
      `Node ${klass.name} has not been registered. Ensure node has been passed to createEditor.`
    );
  return registered;
}

export function resolveRegisteredNodeAfterReplacements(
  editor: LexicalEditor,
  registered: RegisteredNode
): RegisteredNode {
  while (registered.replaceWithKlass)
    registered = getRegisteredNodeByClass(editor, registered.replaceWithKlass);
  return registered;
}
