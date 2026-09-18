import {
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
} from '@lexical/table';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $isContentBlock } from '@macro-inc/lexical-core/utils/editor-tree';
import {
  $findMatchingParent,
  $getNodeByKey,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';
import type { LexicalSession } from './session';

export function $byId(session: LexicalSession, id: string): LexicalNode {
  const key = session.ids.idToNodeKeyMap.get(id);
  const node = key != null ? $getNodeByKey(key) : null;
  if (!node) {
    throw new Error(`No node with id "${id}"`);
  }
  return node;
}

/**
 * Lock onto a content block by id. Inline ids (text/link spans) resolve UP to
 * the containing paragraph/heading/list item. Table structure is not a content
 * block: a `<td>` id resolves DOWN to the cell's first content child, and a
 * `<table>`/`<tr>` id is rejected. Throws if nothing content-block is found.
 */
export function $blockById(session: LexicalSession, id: string): ElementNode {
  const start = $byId(session, id);
  if ($isTableCellNode(start)) {
    const content = start.getChildren().find($isContentBlock);
    if (!content) {
      throw new Error(
        `id "${id}" is a <td> with no content block — use setCell or the cell's paragraph id`
      );
    }
    return content;
  }
  if ($isTableNode(start) || $isTableRowNode(start)) {
    throw new Error(
      `id "${id}" is a <${start.getType()}>, not a content block`
    );
  }
  const node = $findMatchingParent(start, $isContentBlock);
  if (!node) {
    throw new Error(`No block-level node for id "${id}"`);
  }
  return node;
}

/**
 * Resolve a text node by its XML id (the `id` attr on `<t>` elements). Use
 * this in XML mode when you want to act on a specific text span without
 * knowing its parent block id. Throws if the id resolves to a non-text node.
 */
export function $textById(session: LexicalSession, id: string): TextNode {
  const node = $byId(session, id);
  if (!$isTextNode(node)) throw new Error(`Node "${id}" is not a TextNode`);
  return node;
}

export type TextMatch = { node: string; start: number; end: number };
export type LocateScope = { kind: 'nth'; n: number } | { kind: 'all' };

/** Find occurrences of `match` within `block`'s text nodes, filtered by scope. */
export function $locate(
  block: ElementNode,
  match: string,
  scope?: LocateScope
): TextMatch[] {
  const all = scope?.kind === 'all';
  const nth = scope?.kind === 'nth' ? scope.n : undefined;
  const out: TextMatch[] = [];
  let occurrences = 0;
  for (const textNode of block.getAllTextNodes()) {
    const content = textNode.getTextContent();
    const nodeId = $getId(textNode);
    let index = content.indexOf(match);
    while (index !== -1) {
      occurrences++;
      const take =
        all || (nth == null ? occurrences === 1 : occurrences === nth);
      if (take && nodeId)
        out.push({ node: nodeId, start: index, end: index + match.length });
      index = content.indexOf(match, index + match.length);
    }
  }
  return out;
}
