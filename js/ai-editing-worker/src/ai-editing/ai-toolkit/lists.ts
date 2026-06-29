import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListNode,
  type ListType,
} from '@lexical/list';
import { $isElementNode, type ElementNode, type LexicalNode } from 'lexical';
import { $retypeContainer, type LexicalSession } from './session';

export type ListKind = 'bullet' | 'number' | 'check';

/**
 * Convert a set of blocks into a single list of the given kind. Each block
 * becomes a list item carrying that block's inline content. The list replaces
 * the first block; the rest are removed. Returns the new `ListNode`.
 */
export function $toggleList(blocks: LexicalNode[], type: ListKind): ListNode {
  const [first, ...rest] = blocks;
  if (!first || !$isElementNode(first)) {
    throw new Error('$toggleList needs at least one block');
  }
  // $toggleList WRAPS plain blocks into a new list. To change the type of a list
  // that already exists, use $setListType (which preserves nesting) — wrapping a
  // list item here would orphan it to the top level.
  if ($isListItemNode(first)) {
    throw new Error(
      '$toggleList wraps non-list blocks; to change an existing list type use $setListType'
    );
  }
  const list = $createListNode(type as ListType);
  const makeItem = (block: ElementNode) => {
    const item = $createListItemNode(type === 'check' ? false : undefined);
    item.append(...block.getChildren());
    return item;
  };
  list.append(makeItem(first));
  for (const node of rest) {
    if ($isElementNode(node)) {
      list.append(makeItem(node));
    }
  }
  first.replace(list);
  for (const node of rest) {
    node.remove();
  }
  return list;
}

/**
 * Change the type of the list enclosing `node` (a list, or any item in it) —
 * bullet ↔ number ↔ check — retyping the list node itself, preserving its
 * position, nesting, indentation, and the items' ids. Returns the retyped list.
 */
export function $setListType(
  node: LexicalNode,
  type: ListKind,
  session: LexicalSession
): ListNode {
  let list: LexicalNode | null = node;
  while (list && !$isListNode(list)) {
    list = list.getParent();
  }
  if (!$isListNode(list)) {
    throw new Error('$setListType: no enclosing list');
  }
  return $retypeContainer(session, list, $createListNode(type as ListType));
}
