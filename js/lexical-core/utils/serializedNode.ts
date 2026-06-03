import type { LexicalNode, SerializedLexicalNode } from 'lexical';

export function $isSerializedNode(
  node: LexicalNode | SerializedLexicalNode
): node is SerializedLexicalNode {
  return (
    typeof node === 'object' &&
    'type' in node &&
    typeof node.type === 'string' &&
    (node.$ === undefined || typeof node.$ === 'object')
  );
}
