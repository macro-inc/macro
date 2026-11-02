import { ENABLE_MARKDOWN_SEARCH_TEXT } from '@core/constant/featureFlags';
import { isSerializedDraftCommentNode } from '@macro-inc/lexical-core';
import {
  $getRoot,
  $isElementNode,
  type EditorState,
  type ElementNode,
  type LexicalNode,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';

type NodeExport = {
  children: NodeExport[];
  serialized: SerializedLexicalNode | undefined;
  topLevel: boolean;
};

function exportElement(node: ElementNode, children: SerializedLexicalNode[]) {
  const serialized = node.exportJSON();
  if (!Array.isArray(serialized.children))
    throw new Error('Element exportJSON must provide a children array');
  return { ...serialized, children: [...serialized.children, ...children] };
}

/**
 * A provider-owned export cache. Lexical snapshots share immutable nodes, but
 * an unchanged element can resolve different children in another snapshot.
 * Visit children under that snapshot's read scope before reusing its export.
 * Cached JSON is immutable too: Mirror may freeze it after synchronization.
 */
export function createLoroStateSerializer() {
  const cache = new WeakMap<LexicalNode, NodeExport>();

  function serialize(node: LexicalNode, topLevel: boolean): NodeExport {
    const children = $isElementNode(node)
      ? node.getChildren().map((child) => serialize(child, false))
      : [];
    const previous = cache.get(node);
    if (
      previous?.topLevel === topLevel &&
      previous.children.length === children.length &&
      children.every((child, i) => child === previous.children[i])
    )
      return previous;

    // Retain raw child-export identities even when their content is omitted.
    // A completion edit still changes the top-level node's raw search text.
    const serializedChildren = flattenChildren(children);
    let serialized: SerializedLexicalNode | undefined = $isElementNode(node)
      ? exportElement(node, serializedChildren)
      : node.exportJSON();
    if (serialized.type !== node.getType())
      throw new Error('Node exportJSON must preserve its type');
    if (serialized.type === 'completion') serialized = undefined;
    if (serialized && topLevel && ENABLE_MARKDOWN_SEARCH_TEXT) {
      const id = serialized.$?.id;
      if (typeof id === 'string' && $isElementNode(node))
        serialized = {
          ...serialized,
          $: { ...serialized.$, searchText: node.getTextContent() },
        };
    }
    const result = { children, serialized, topLevel };
    cache.set(node, result);
    return result;
  }

  function flattenChildren(children: NodeExport[]): SerializedLexicalNode[] {
    return children.flatMap(({ serialized }) => {
      if (!serialized) return [];
      return isSerializedDraftCommentNode(serialized)
        ? serialized.children
        : [serialized];
    });
  }

  return (state: EditorState): SerializedEditorState =>
    state.read(() => {
      const root = $getRoot();
      const children = root
        .getChildren()
        .map((child) => serialize(child, true));
      return { root: exportElement(root, flattenChildren(children)) };
    });
}
