import {
  $getNodeByKey,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';
import { $getId } from '../../../../lexical-core/plugins/nodeIdPlugin';
import type { LexicalSession } from './session';
import { collectTextNodes } from './tree';

export function $byId(session: LexicalSession, id: string): LexicalNode {
  const key = session.ids.idToNodeKeyMap.get(id);
  const node = key != null ? $getNodeByKey(key) : null;
  if (!node) {
    throw new Error(`No node with id "${id}"`);
  }
  return node;
}

/**
 * Lock onto a block by id. Since every node carries an id (including inline
 * text/link spans), an id that points at an inline node resolves UP to its
 * nearest block-level element (the containing paragraph, heading, list item,
 * quote, …). Throws `Error` only if nothing block-level is found.
 */
export function $blockById(session: LexicalSession, id: string): ElementNode {
  let node: LexicalNode | null = $byId(session, id);
  while (node && !($isElementNode(node) && !node.isInline())) {
    node = node.getParent();
  }
  if (!node || !$isElementNode(node)) {
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

/** Find occurrences of `match` within `block`'session text nodes, filtered by scope. */
export function $locate(
  block: ElementNode,
  match: string,
  scope?: LocateScope
): TextMatch[] {
  const all = scope?.kind === 'all';
  const nth = scope?.kind === 'nth' ? scope.n : undefined;
  const out: TextMatch[] = [];
  let occurrences = 0;
  for (const textNode of collectTextNodes(block)) {
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
