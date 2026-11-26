import type { SerializedLexicalNode } from 'lexical';
import { markdownChildren } from './projectSharedMarkdownState';

/** Keep legacy local state on the Loro container that already holds it. */
export function preserveStoredLocalStatus(
  node: SerializedLexicalNode,
  stored?: SerializedLexicalNode
): void {
  const storedLocal = stored?.$?.local;
  if (node.$?.local !== undefined || storedLocal !== undefined) {
    const { local: _local, ...metadata } = node.$ ?? {};
    if (storedLocal !== undefined) metadata.local = storedLocal;
    if (Object.keys(metadata).length > 0) node.$ = metadata;
    else delete node.$;
  }
}

/** Ignore peer-local state when deciding whether document content changed. */
export function withoutLocalStatus(
  node: SerializedLexicalNode
): SerializedLexicalNode {
  let content = node;
  if (node.$?.local !== undefined) {
    const { local: _local, ...metadata } = node.$;
    content = { ...node };
    if (Object.keys(metadata).length > 0) content.$ = metadata;
    else delete content.$;
  }

  const original = markdownChildren(node);
  if (!original?.length) return content;
  const projected = original.map(withoutLocalStatus);
  if (!projected.some((child, index) => child !== original[index]))
    return content;

  const withChildren = { ...content, children: projected };
  return withChildren;
}
